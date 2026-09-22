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

// Deckt die /clipboard/*-Verdrahtung in Program.cs ab (Origin-Pruefung, Bearer-Token,
// Laengen-/Groessenlimit, Fehlerabbildung). IClipboardService wird ueber
// Program.BuildApplication's configureServices-Hook durch FakeClipboardService ersetzt, damit
// kein Test die echte Systemzwischenablage der Maschine veraendert.
[TestClass]
public sealed class ClipboardEndpointTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private string testDirectory = null!;
    private WebApplication app = null!;
    private HttpClient httpClient = null!;
    private string baseUrl = null!;
    private FakeClipboardService fakeClipboard = null!;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        var testRoot = Path.Combine(Path.GetTempPath(), "YFRemote.Server.Tests");
        testDirectory = Path.Combine(testRoot, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(testDirectory);

        var port = GetFreeTcpPort();
        baseUrl = $"http://127.0.0.1:{port}";

        fakeClipboard = new FakeClipboardService();

        app = Program.BuildApplication(
            [
                "Server:Host=127.0.0.1",
                $"Server:Port={port}",
                $"PairingStorage:DevicesFilePath={Path.Combine(testDirectory, "devices.json")}",
                "Clipboard:MaxTextLength=20",
                "Clipboard:MaxImageSizeBytes=1024"
            ],
            services => services.AddSingleton<IClipboardService>(fakeClipboard));
        await app.StartAsync();

        httpClient = new HttpClient { BaseAddress = new Uri(baseUrl) };
    }

    [TestCleanup]
    public async Task CleanupAsync()
    {
        httpClient.Dispose();
        await app.StopAsync();
        await app.DisposeAsync();

        if (Directory.Exists(testDirectory))
        {
            Directory.Delete(testDirectory, recursive: true);
        }
    }

    [TestMethod]
    public async Task SendText_WithoutBearerToken_IsUnauthorized()
    {
        var response = await PostTextAsync("hallo", token: null);

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task SendText_WithMismatchedOrigin_IsRejected()
    {
        var token = await PairAndGetTokenAsync();

        using var request = new HttpRequestMessage(HttpMethod.Post, "/clipboard/text")
        {
            Content = JsonBody("""{"text":"hallo"}""")
        };
        request.Headers.Add("Origin", "http://evil.example.com");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await httpClient.SendAsync(request);

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [TestMethod]
    public async Task SendText_WithValidTokenAndOrigin_ForwardsTextToClipboardService()
    {
        var token = await PairAndGetTokenAsync();

        var response = await PostTextAsync("Hallo Welt", token);
        var body = await response.Content.ReadFromJsonAsync<ClipboardResponse>(JsonOptions);

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.IsTrue(body!.Success);
        Assert.AreEqual("Hallo Welt", fakeClipboard.LastText);
    }

    [TestMethod]
    public async Task SendText_Empty_ReturnsBadRequest()
    {
        var token = await PairAndGetTokenAsync();

        var response = await PostTextAsync("", token);

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.IsNull(fakeClipboard.LastText);
    }

    [TestMethod]
    public async Task SendText_ExceedingConfiguredMaxLength_ReturnsBadRequest()
    {
        var token = await PairAndGetTokenAsync();

        var response = await PostTextAsync(new string('x', 21), token);

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.IsNull(fakeClipboard.LastText);
    }

    [TestMethod]
    public async Task SendImage_WithValidTokenAndOrigin_ForwardsBytesToClipboardService()
    {
        var token = await PairAndGetTokenAsync();
        var imageBytes = new byte[] { 1, 2, 3, 4 };

        var response = await PostImageAsync(imageBytes, token);
        var body = await response.Content.ReadFromJsonAsync<ClipboardResponse>(JsonOptions);

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.IsTrue(body!.Success);
        CollectionAssert.AreEqual(imageBytes, fakeClipboard.LastImageBytes);
    }

    [TestMethod]
    public async Task SendImage_ExceedingConfiguredMaxSize_ReturnsPayloadTooLarge()
    {
        var token = await PairAndGetTokenAsync();

        var response = await PostImageAsync(new byte[2000], token);

        Assert.AreEqual(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.IsNull(fakeClipboard.LastImageBytes);
    }

    [TestMethod]
    public async Task SendText_WhenClipboardServiceThrowsNotSupported_ReturnsNotImplemented()
    {
        var token = await PairAndGetTokenAsync();
        fakeClipboard.ThrowOnNextCall = new NotSupportedException("Clipboard sync is not supported on Linux yet.");

        var response = await PostTextAsync("hallo", token);
        var body = await response.Content.ReadFromJsonAsync<ClipboardResponse>(JsonOptions);

        Assert.AreEqual(HttpStatusCode.NotImplemented, response.StatusCode);
        Assert.IsFalse(body!.Success);
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

    private async Task<HttpResponseMessage> PostTextAsync(string text, string? token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/clipboard/text")
        {
            Content = JsonBody($$"""{"text":{{JsonSerializer.Serialize(text)}}}""")
        };
        request.Headers.Add("Origin", baseUrl);
        if (token is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return await httpClient.SendAsync(request);
    }

    private async Task<HttpResponseMessage> PostImageAsync(byte[] imageBytes, string? token)
    {
        using var form = new MultipartFormDataContent();
        var filePart = new ByteArrayContent(imageBytes);
        filePart.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        form.Add(filePart, "file", "bild.png");

        using var request = new HttpRequestMessage(HttpMethod.Post, "/clipboard/image") { Content = form };
        request.Headers.Add("Origin", baseUrl);
        if (token is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return await httpClient.SendAsync(request);
    }

    private static StringContent JsonBody(string json) => new(json, Encoding.UTF8, "application/json");

    private static int GetFreeTcpPort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            return ((IPEndPoint)listener.LocalEndpoint).Port;
        }
        finally
        {
            listener.Stop();
        }
    }
}
