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

        await StartAppAsync(maxFileSizeBytes: 1024);
    }

    private async Task StartAppAsync(long maxFileSizeBytes)
    {
        var port = GetFreeTcpPort();
        baseUrl = $"http://127.0.0.1:{port}";

        app = Program.BuildApplication([
            "Server:Host=127.0.0.1",
            $"Server:Port={port}",
            $"PairingStorage:DevicesFilePath={Path.Combine(testDirectory, "devices.json")}",
            $"Diagnostics:LogDirectory={Path.Combine(testDirectory, "Logs")}",
            $"UserSettings:FilePath={Path.Combine(testDirectory, "settings.json")}",
            $"FileTransfer:TargetDirectory={filesDirectory}",
            $"FileTransfer:MaxFileSizeBytes={maxFileSizeBytes}"
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

    // FormOptions.MultipartBodyLengthLimit steht sonst auf 128 MB und wuerde ein groesseres
    // Limit stillschweigend unterlaufen.
    [TestMethod]
    public async Task UploadFile_LargerThanDefaultFormLimit_IsAcceptedWhenConfiguredMaxAllowsIt()
    {
        httpClient.Dispose();
        await app.StopAsync();
        await app.DisposeAsync();
        await StartAppAsync(maxFileSizeBytes: 200L * 1024 * 1024);
        var token = await PairAndGetTokenAsync();
        const int size = 129 * 1024 * 1024;

        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(new byte[size]), "file", "gross.bin");
        using var request = new HttpRequestMessage(HttpMethod.Post, "/files") { Content = form };
        request.Headers.Add("Origin", baseUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await httpClient.SendAsync(request);

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual(size, new FileInfo(Path.Combine(filesDirectory, "gross.bin")).Length);
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

    [TestMethod]
    public async Task DownloadOfferedFile_WithoutBearerToken_IsUnauthorized()
    {
        var offer = OfferFile("angebot.txt", "Vom PC");

        var response = await httpClient.GetAsync($"/files/{offer.Id}");

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task DownloadOfferedFile_WithUnknownId_ReturnsNotFound()
    {
        var token = await PairAndGetTokenAsync();
        OfferFile("angebot.txt", "Vom PC");

        var response = await GetOfferedFileAsync(Guid.NewGuid(), token);

        Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode);
    }

    [TestMethod]
    public async Task DownloadOfferedFile_WithValidToken_ReturnsFileAsAttachment()
    {
        var token = await PairAndGetTokenAsync();
        var offer = OfferFile("angebot.txt", "Vom PC");

        var response = await GetOfferedFileAsync(offer.Id, token);

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual("Vom PC", await response.Content.ReadAsStringAsync());
        Assert.AreEqual("angebot.txt", response.Content.Headers.ContentDisposition?.FileNameStar);
    }

    [TestMethod]
    public async Task Folder_ListsAndServesOnlyFilesDirectlyInTheTargetDirectory()
    {
        var token = await PairAndGetTokenAsync();
        Directory.CreateDirectory(Path.Combine(filesDirectory, "unterordner"));
        File.WriteAllText(Path.Combine(filesDirectory, "bericht.txt"), "Inhalt");
        File.WriteAllText(Path.Combine(filesDirectory, "unterordner", "tief.txt"), "tief");
        File.WriteAllText(Path.Combine(testDirectory, "ausserhalb.txt"), "geheim");

        using var unauthorized = await httpClient.GetAsync("/folder");
        using var list = await GetWithTokenAsync("/folder", token);
        using var file = await GetWithTokenAsync("/folder/bericht.txt", token);
        using var nested = await GetWithTokenAsync("/folder/unterordner%2Ftief.txt", token);
        using var outside = await GetWithTokenAsync("/folder/..%2Fausserhalb.txt", token);
        using var outsideBackslash = await GetWithTokenAsync("/folder/..%5Causserhalb.txt", token);

        Assert.AreEqual(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        Assert.AreEqual(
            """{"files":[{"name":"bericht.txt","size":6}]}""",
            await list.Content.ReadAsStringAsync());
        Assert.AreEqual("Inhalt", await file.Content.ReadAsStringAsync());
        Assert.AreEqual("bericht.txt", file.Content.Headers.ContentDisposition?.FileNameStar);
        Assert.AreEqual(HttpStatusCode.NotFound, nested.StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, outside.StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, outsideBackslash.StatusCode);
    }

    [TestMethod]
    public async Task Processes_AreListedForPairedDeviceOnly()
    {
        var token = await PairAndGetTokenAsync();

        using var unauthorized = await httpClient.GetAsync("/processes");
        using var list = await GetWithTokenAsync("/processes", token);
        using var json = JsonDocument.Parse(await list.Content.ReadAsStringAsync());

        Assert.AreEqual(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, list.StatusCode);
        var first = json.RootElement.GetProperty("processes")[0];
        Assert.IsTrue(first.GetProperty("id").GetInt32() > 0);
        Assert.IsTrue(first.GetProperty("name").GetString()!.Length > 0);
    }

    private Task<HttpResponseMessage> GetWithTokenAsync(string url, string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return httpClient.SendAsync(request);
    }

    private FileOfferMessage OfferFile(string fileName, string content)
    {
        var path = Path.Combine(testDirectory, fileName);
        File.WriteAllText(path, content);
        return app.Services.GetRequiredService<FileOfferService>().Offer(path);
    }

    // Ohne Origin, wie ein Same-Origin-fetch() im Browser.
    private Task<HttpResponseMessage> GetOfferedFileAsync(Guid id, string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, $"/files/{id}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return httpClient.SendAsync(request);
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
