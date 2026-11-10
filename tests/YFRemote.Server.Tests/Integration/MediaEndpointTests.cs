using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using YFRemote.Server.Models;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Integration;

// Deckt GET /media/cover (Endpoints/MediaEndpoints.cs), GET /launch/apps, GET /windows und GET /screen
// ab. Die Dienste dahinter werden wie in ClipboardEndpointTests ueber den configureServices-Hook ersetzt,
// damit kein Test von Medien-App, Startmenue oder Fenstern der Maschine abhaengt.
[TestClass]
public sealed class MediaEndpointTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private string testDirectory = null!;
    private WebApplication app = null!;
    private HttpClient httpClient = null!;
    private string baseUrl = null!;
    private FakeMediaControl media = null!;
    private FakeScreenCapture screen = null!;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        testDirectory = Path.Combine(Path.GetTempPath(), "YFRemote.Server.Tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(testDirectory);

        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        baseUrl = $"http://127.0.0.1:{port}";

        media = new FakeMediaControl();
        screen = new FakeScreenCapture();
        app = Program.BuildApplication(
            [
                "Server:Host=127.0.0.1",
                $"Server:Port={port}",
                $"PairingStorage:DevicesFilePath={Path.Combine(testDirectory, "devices.json")}"
            ],
            services => services
                .AddSingleton<IMediaControl>(media)
                .AddSingleton<IAppLauncher>(new FakeAppLauncher())
                .AddSingleton<IWindowService>(new FakeWindowService())
                .AddSingleton<IScreenCapture>(screen)
                .AddSingleton<IAudioCapture>(new FakeAudioCapture()));
        await app.StartAsync();

        httpClient = new HttpClient { BaseAddress = new Uri(baseUrl) };
    }

    [TestCleanup]
    public async Task CleanupAsync()
    {
        httpClient.Dispose();
        await app.StopAsync();
        await app.DisposeAsync();
        Directory.Delete(testDirectory, recursive: true);
    }

    [TestMethod]
    public async Task Cover_WithoutBearerToken_IsUnauthorized()
    {
        media.Cover = new MediaCover([1, 2, 3], "image/jpeg", "abc");

        var response = await GetCoverAsync(token: null);

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task Cover_WithoutCover_ReturnsNoContent()
    {
        var response = await GetCoverAsync(await PairAndGetTokenAsync());

        Assert.AreEqual(HttpStatusCode.NoContent, response.StatusCode);
    }

    [TestMethod]
    public async Task Cover_WithCover_ReturnsImageWithoutCaching()
    {
        var token = await PairAndGetTokenAsync();
        byte[] jpeg = [0xFF, 0xD8, 0xFF, 1, 2];
        media.Cover = new MediaCover(jpeg, "image/jpeg", "abc");

        var response = await GetCoverAsync(token);

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual("image/jpeg", response.Content.Headers.ContentType!.MediaType);
        CollectionAssert.AreEqual(jpeg, await response.Content.ReadAsByteArrayAsync());
        Assert.IsTrue(response.Headers.CacheControl!.NoStore);
    }

    [TestMethod]
    public async Task MediaOnlyDevice_GetsCoverButNotLaunchApps()
    {
        var token = await PairAndGetTokenAsync();
        var pairing = app.Services.GetRequiredService<PairingService>();
        Assert.IsTrue(pairing.SetMediaOnly(pairing.GetPairedDevices()[0].Id, mediaOnly: true));
        media.Cover = new MediaCover([0xFF, 0xD8, 0xFF], "image/jpeg", "abc");
        using var request = new HttpRequestMessage(HttpMethod.Get, "/launch/apps");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var cover = await GetCoverAsync(token);
        var apps = await httpClient.SendAsync(request);

        Assert.AreEqual(HttpStatusCode.OK, cover.StatusCode);
        Assert.AreEqual(HttpStatusCode.Forbidden, apps.StatusCode);
        Assert.AreEqual("Not allowed for this device.", await apps.Content.ReadAsStringAsync());
    }

    [TestMethod]
    public async Task LaunchApps_ListsAppsForPairedDeviceOnly()
    {
        using var unauthorized = await httpClient.GetAsync("/launch/apps");
        using var request = new HttpRequestMessage(HttpMethod.Get, "/launch/apps");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await PairAndGetTokenAsync());

        var response = await httpClient.SendAsync(request);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);

        Assert.AreEqual(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual("""["Discord","Spotify"]""", body.GetProperty("apps").GetRawText());
    }

    [TestMethod]
    public async Task Windows_ListsOpenWindowsForPairedDeviceOnly()
    {
        using var unauthorized = await httpClient.GetAsync("/windows");
        using var request = new HttpRequestMessage(HttpMethod.Get, "/windows");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await PairAndGetTokenAsync());

        var response = await httpClient.SendAsync(request);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);

        Assert.AreEqual(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual(
            """[{"id":"131072","title":"Editor","app":"Notepad"}]""",
            body.GetProperty("windows").GetRawText());
    }

    [TestMethod]
    public async Task Screen_ReturnsJpegForPairedDeviceWithClampedWidth()
    {
        var token = await PairAndGetTokenAsync();
        using var unauthorized = await httpClient.GetAsync("/screen");

        var response = await GetScreenAsync(token, "/screen?width=99999&quality=5");

        Assert.AreEqual(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual("image/jpeg", response.Content.Headers.ContentType!.MediaType);
        Assert.IsTrue(response.Headers.CacheControl!.NoStore);
        CollectionAssert.AreEqual(FakeScreenCapture.Jpeg, await response.Content.ReadAsByteArrayAsync());
        Assert.AreEqual(3840, screen.LastMaxWidth);
        Assert.AreEqual(30, screen.LastQuality);
    }

    [TestMethod]
    public async Task Health_ReportsScreenWhenCaptureIsRegistered()
    {
        var health = await httpClient.GetFromJsonAsync<HealthResponse>("/health", JsonOptions);

        Assert.IsTrue(health!.Screen);
        Assert.IsTrue(health.Audio);
    }

    [TestMethod]
    public async Task ScreenAudio_StreamsPcmWithFormatHeaders()
    {
        var token = await PairAndGetTokenAsync();
        using var unauthorized = await httpClient.GetAsync("/screen/audio");
        using var request = new HttpRequestMessage(HttpMethod.Get, "/screen/audio");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
        await using var body = await response.Content.ReadAsStreamAsync();
        var chunk = new byte[FakeAudioCapture.Chunk.Length];
        await body.ReadExactlyAsync(chunk);

        Assert.AreEqual(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual("48000", response.Headers.GetValues("X-Sample-Rate").Single());
        Assert.AreEqual("2", response.Headers.GetValues("X-Channels").Single());
        Assert.IsTrue(response.Headers.CacheControl!.NoStore);
        CollectionAssert.AreEqual(FakeAudioCapture.Chunk, chunk);
    }

    [TestMethod]
    public async Task Screen_IsUnavailableOnSecureDesktopAndForMediaOnlyDevices()
    {
        var token = await PairAndGetTokenAsync();
        screen.Blocked = true;

        var blocked = await GetScreenAsync(token, "/screen");
        var pairing = app.Services.GetRequiredService<PairingService>();
        Assert.IsTrue(pairing.SetMediaOnly(pairing.GetPairedDevices()[0].Id, mediaOnly: true));
        var mediaOnly = await GetScreenAsync(token, "/screen");

        Assert.AreEqual(HttpStatusCode.ServiceUnavailable, blocked.StatusCode);
        Assert.AreEqual(HttpStatusCode.Forbidden, mediaOnly.StatusCode);
    }

    [TestMethod]
    public async Task ScreenVideo_StreamsFragmentsWithCodecHeader()
    {
        var token = await PairAndGetTokenAsync();
        using var unauthorized = await httpClient.GetAsync("/screen/video");

        var response = await GetScreenAsync(token, "/screen/video?width=99999&bitrate=1");

        Assert.AreEqual(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual("video/mp4", response.Content.Headers.ContentType!.MediaType);
        Assert.AreEqual("avc1.4d0028", response.Headers.GetValues("X-Codec").Single());
        Assert.IsTrue(response.Headers.CacheControl!.NoStore);
        CollectionAssert.AreEqual(FakeScreenCapture.Fragment.Concat(FakeScreenCapture.Fragment).ToArray(), await response.Content.ReadAsByteArrayAsync());
        Assert.AreEqual(3840, screen.LastMaxWidth);
        Assert.AreEqual(1000, screen.LastBitrate);
    }

    [TestMethod]
    public async Task ScreenMonitors_ListsMonitorsForPairedDevicesOnly()
    {
        var token = await PairAndGetTokenAsync();
        using var unauthorized = await httpClient.GetAsync("/screen/monitors");

        var response = await GetScreenAsync(token, "/screen/monitors");
        var json = await response.Content.ReadAsStringAsync();
        var pairing = app.Services.GetRequiredService<PairingService>();
        Assert.IsTrue(pairing.SetMediaOnly(pairing.GetPairedDevices()[0].Id, mediaOnly: true));
        var mediaOnly = await GetScreenAsync(token, "/screen/monitors");

        Assert.AreEqual(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.IsTrue(response.Headers.CacheControl!.NoStore);
        using var document = JsonDocument.Parse(json);
        var monitors = document.RootElement.GetProperty("monitors");
        Assert.AreEqual(2, monitors.GetArrayLength());
        Assert.AreEqual(@"\\.\DISPLAY2", monitors[1].GetProperty("id").GetString());
        Assert.AreEqual(2560, monitors[1].GetProperty("width").GetInt32());
        Assert.AreEqual(1440, monitors[1].GetProperty("height").GetInt32());
        Assert.IsFalse(monitors[1].GetProperty("primary").GetBoolean());
        Assert.AreEqual(HttpStatusCode.Forbidden, mediaOnly.StatusCode);
    }

    [TestMethod]
    public async Task Screen_PassesTheChosenMonitor()
    {
        var token = await PairAndGetTokenAsync();
        var id = Uri.EscapeDataString(@"\\.\DISPLAY2");

        await GetScreenAsync(token, $"/screen?monitor={id}");
        Assert.AreEqual(@"\\.\DISPLAY2", screen.LastMonitor);

        await GetScreenAsync(token, "/screen");
        Assert.IsNull(screen.LastMonitor);

        await GetScreenAsync(token, $"/screen/video?monitor={id}");
        Assert.AreEqual(@"\\.\DISPLAY2", screen.LastMonitor);
    }

    [TestMethod]
    public async Task ScreenVideo_WithoutAccessToTheScreen_IsUnavailable()
    {
        var token = await PairAndGetTokenAsync();
        screen.Blocked = true;

        var response = await GetScreenAsync(token, "/screen/video");

        Assert.AreEqual(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [TestMethod]
    public async Task ScreenVideo_WithoutHardwareEncoder_IsNotImplemented()
    {
        var token = await PairAndGetTokenAsync();
        screen.VideoSupported = false;

        var response = await GetScreenAsync(token, "/screen/video");

        Assert.AreEqual(HttpStatusCode.NotImplemented, response.StatusCode);
    }

    private async Task<HttpResponseMessage> GetScreenAsync(string token, string path)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await httpClient.SendAsync(request);
    }

    private async Task<HttpResponseMessage> GetCoverAsync(string? token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/media/cover");
        if (token is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return await httpClient.SendAsync(request);
    }

    private async Task<string> PairAndGetTokenAsync()
    {
        var pin = app.Services.GetRequiredService<PairingService>().GetCurrentPin().Pin;
        using var request = new HttpRequestMessage(HttpMethod.Post, "/pair")
        {
            Content = new StringContent(
                $$"""{"pin":"{{pin}}","deviceName":"Testgerät"}""",
                Encoding.UTF8,
                "application/json")
        };
        request.Headers.Add("Origin", baseUrl);

        var response = await httpClient.SendAsync(request);
        var body = await response.Content.ReadFromJsonAsync<PairResponse>(JsonOptions);
        return body!.Token!;
    }

    private sealed class FakeScreenCapture : IScreenCapture
    {
        public static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 7];

        public bool Blocked { get; set; }

        public int LastMaxWidth { get; private set; }

        public int LastQuality { get; private set; }

        public string? LastMonitor { get; private set; }

        public IReadOnlyList<ScreenMonitor> ListMonitors() =>
            [new(@"\\.\DISPLAY1", 0, 0, 1920, 1080, true), new(@"\\.\DISPLAY2", 1920, 0, 2560, 1440, false)];

        public byte[] CaptureJpeg(int maxWidth, int quality, string? monitor)
        {
            LastMaxWidth = maxWidth;
            LastQuality = quality;
            LastMonitor = monitor;
            return Blocked ? throw new System.ComponentModel.Win32Exception(5) : Jpeg;
        }

        public static readonly byte[] Fragment = [0, 0, 0, 8, 0x6D, 0x64, 0x61, 0x74];

        public bool VideoSupported { get; set; } = true;

        public int LastBitrate { get; private set; }

        public async Task StreamVideoAsync(int maxWidth, int bitrateKbps, string? monitor, Action<string> onStart, Func<byte[], Task> onFragment, CancellationToken cancellationToken)
        {
            LastMaxWidth = maxWidth;
            LastBitrate = bitrateKbps;
            LastMonitor = monitor;
            if (Blocked)
            {
                throw new System.ComponentModel.Win32Exception(5);
            }

            if (!VideoSupported)
            {
                throw new NotSupportedException();
            }

            onStart("avc1.4d0028");
            await onFragment(Fragment);
            await onFragment(Fragment);
        }
    }

    private sealed class FakeAudioCapture : IAudioCapture
    {
        public static readonly byte[] Chunk = [1, 2, 3, 4];

        public async Task CaptureAsync(
            Action<int, int> started,
            Func<ReadOnlyMemory<byte>, Task> write,
            CancellationToken cancellationToken)
        {
            started(48000, 2);
            await write(Chunk);
            await Task.Delay(Timeout.Infinite, cancellationToken);
        }
    }

    private sealed class FakeWindowService : IWindowService
    {
        public IReadOnlyList<OpenWindow> ListWindows() => [new OpenWindow("131072", "Editor", "Notepad")];

        public bool TryApply(string id, WindowCommand command) => false;
    }

    private sealed class FakeAppLauncher : IAppLauncher
    {
        public IReadOnlyList<string> ListApps() => ["Discord", "Spotify"];

        public bool TryLaunchApp(string name) => false;

        public void OpenUrl(Uri url)
        {
        }
    }

    private sealed class FakeMediaControl : IMediaControl
    {
        public MediaCover? Cover { get; set; }

        public void Seek(double seconds)
        {
        }
    }
}
