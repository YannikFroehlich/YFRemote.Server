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

// Deckt die /files-Verdrahtung (Endpoints/FileEndpoints.cs) ab (Origin-Pruefung, Bearer-Token, Groessenlimit,
// Routing) ueber den echten HTTP-Stack; SaveFile selbst (Sanitizing, Dedup, Streaming-Limit) ist
// bereits in FileTransferServiceTests isoliert abgedeckt.
[TestClass]
public sealed class FileTransferEndpointTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private string testDirectory = null!;
    private string filesDirectory = null!;
    private WebApplication app = null!;
    private HttpClient httpClient = null!;
    private string baseUrl = null!;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        var testRoot = Path.Combine(Path.GetTempPath(), "YFRemote.Server.Tests");
        testDirectory = Path.Combine(testRoot, Guid.NewGuid().ToString("N"));
        filesDirectory = Path.Combine(testDirectory, "files");
        Directory.CreateDirectory(testDirectory);

        var port = GetFreeTcpPort();
        baseUrl = $"http://127.0.0.1:{port}";

        app = Program.BuildApplication([
            "Server:Host=127.0.0.1",
            $"Server:Port={port}",
            $"PairingStorage:DevicesFilePath={Path.Combine(testDirectory, "devices.json")}",
            $"FileTransfer:TargetDirectory={filesDirectory}",
            "FileTransfer:MaxFileSizeBytes=1024"
        ]);
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
    public async Task UploadFile_WithoutBearerToken_IsUnauthorized()
    {
        var response = await PostFileAsync("hallo.txt", "Hallo Welt", token: null);

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task UploadFile_WithMismatchedOrigin_IsRejected()
    {
        var token = await PairAndGetTokenAsync();

        using var request = new HttpRequestMessage(HttpMethod.Post, "/files")
        {
            Content = MultipartBody("hallo.txt", "Hallo Welt")
        };
        request.Headers.Add("Origin", "http://evil.example.com");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await httpClient.SendAsync(request);

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [TestMethod]
    public async Task UploadFile_WithValidTokenAndOrigin_SavesFileUnderTargetDirectory()
    {
        var token = await PairAndGetTokenAsync();

        var response = await PostFileAsync("hallo.txt", "Hallo Welt", token);
        var body = await response.Content.ReadFromJsonAsync<FileUploadResponse>(JsonOptions);

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.IsTrue(body!.Success);
        Assert.AreEqual("hallo.txt", body.FileName);
        Assert.AreEqual("Hallo Welt", await File.ReadAllTextAsync(Path.Combine(filesDirectory, "hallo.txt")));
    }

    [TestMethod]
    public async Task UploadFile_ExceedingConfiguredMaxSize_ReturnsPayloadTooLarge()
    {
        var token = await PairAndGetTokenAsync();

        var response = await PostFileAsync("zu-gross.txt", new string('x', 2000), token);

        Assert.AreEqual(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.IsFalse(File.Exists(Path.Combine(filesDirectory, "zu-gross.txt")));
    }

    [TestMethod]
    public async Task UploadFile_WithPathTraversalFileName_IsSavedUnderTargetDirectoryOnly()
    {
        var token = await PairAndGetTokenAsync();

        var response = await PostFileAsync("..\\..\\evil.txt", "böse", token);
        var body = await response.Content.ReadFromJsonAsync<FileUploadResponse>(JsonOptions);

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual("evil.txt", body!.FileName);
        Assert.IsTrue(File.Exists(Path.Combine(filesDirectory, "evil.txt")));
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

    private async Task<HttpResponseMessage> PostFileAsync(string fileName, string content, string? token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/files")
        {
            Content = MultipartBody(fileName, content)
        };
        request.Headers.Add("Origin", baseUrl);
        if (token is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return await httpClient.SendAsync(request);
    }

    private static MultipartFormDataContent MultipartBody(string fileName, string content)
    {
        var form = new MultipartFormDataContent();
        var filePart = new ByteArrayContent(Encoding.UTF8.GetBytes(content));
        filePart.Headers.ContentType = new MediaTypeHeaderValue("text/plain");
        form.Add(filePart, "file", fileName);
        return form;
    }

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
