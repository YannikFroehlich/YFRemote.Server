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

// Deckt GET /media/cover (Endpoints/MediaEndpoints.cs), GET /launch/apps und GET /windows ab. Die
// Dienste dahinter werden wie in ClipboardEndpointTests ueber den configureServices-Hook ersetzt,
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
        app = Program.BuildApplication(
            [
                "Server:Host=127.0.0.1",
                $"Server:Port={port}",
                $"PairingStorage:DevicesFilePath={Path.Combine(testDirectory, "devices.json")}"
            ],
            services => services
                .AddSingleton<IMediaControl>(media)
                .AddSingleton<IAppLauncher>(new FakeAppLauncher())
                .AddSingleton<IWindowService>(new FakeWindowService()));
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

    private sealed class FakeWindowService : IWindowService
    {
        public IReadOnlyList<OpenWindow> ListWindows() => [new OpenWindow("131072", "Editor", "Notepad")];

        public bool TryFocus(string id) => false;
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
