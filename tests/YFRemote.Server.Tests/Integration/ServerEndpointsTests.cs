using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using YFRemote.Server.Models;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Integration;

// Deckt die Verdrahtung in Program.cs ab (Origin-Pruefung, Bearer-Token, Endpoint-Routing), die
// von keinem der Service-Unittests beruehrt wird: PairingService, YFRemoteWebSocketHandler und
// WebSocketConnectionRegistry sind dort einzeln getestet, aber nicht ihre Verschaltung über den
// echten HTTP-Stack.
[TestClass]
public sealed class ServerEndpointsTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private string testDirectory = null!;
    private WebApplication app = null!;
    private HttpClient httpClient = null!;
    private string baseUrl = null!;
    private string wsUrl = null!;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        var testRoot = Path.Combine(Path.GetTempPath(), "YFRemote.Server.Tests");
        testDirectory = Path.Combine(testRoot, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(testDirectory);

        var port = GetFreeTcpPort();
        baseUrl = $"http://127.0.0.1:{port}";
        wsUrl = $"ws://127.0.0.1:{port}";

        app = Program.BuildApplication([
            "Server:Host=127.0.0.1",
            $"Server:Port={port}",
            $"PairingStorage:DevicesFilePath={Path.Combine(testDirectory, "devices.json")}"
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
    public async Task Health_ReturnsOkStatus()
    {
        var response = await httpClient.GetFromJsonAsync<HealthResponse>("/health", JsonOptions);

        Assert.AreEqual("ok", response!.Status);
        Assert.AreEqual("YFRemote.Server", response.Service);
    }

    [TestMethod]
    public async Task Pair_WithoutOriginHeader_IsRejected()
    {
        var response = await httpClient.PostAsync("/pair", JsonBody("""{"pin":"000000"}"""));

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [TestMethod]
    public async Task Pair_WithMismatchedOrigin_IsRejected()
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/pair")
        {
            Content = JsonBody("""{"pin":"000000"}""")
        };
        request.Headers.Add("Origin", "http://evil.example.com");

        var response = await httpClient.SendAsync(request);

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [TestMethod]
    public async Task Pair_WithSameOriginAndCorrectPin_Succeeds()
    {
        var response = await PostPairAsync(CurrentPin(), "Testgerät");

        Assert.IsTrue(response.Success, response.Error);
        Assert.IsFalse(string.IsNullOrEmpty(response.Token));
    }

    [TestMethod]
    public async Task Pair_WithSameOriginAndWrongPin_Fails()
    {
        var response = await PostPairAsync(InvalidPin(), "Testgerät");

        Assert.IsFalse(response.Success);
        Assert.AreEqual("PIN ungültig.", response.Error);
    }

    [TestMethod]
    public async Task PairStatus_WithoutOriginHeader_StillWorks()
    {
        var response = await httpClient.GetFromJsonAsync<PairStatusResponse>(
            "/pair/status?token=unknown",
            JsonOptions);

        Assert.IsFalse(response!.Valid);
    }

    [TestMethod]
    public async Task WebSocket_NonUpgradeRequest_ReturnsBadRequest()
    {
        var response = await httpClient.GetAsync("/ws");

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [TestMethod]
    public async Task WebSocket_WithMismatchedOrigin_IsRejected()
    {
        using var socket = new ClientWebSocket();
        socket.Options.SetRequestHeader("Origin", "http://evil.example.com");

        await Assert.ThrowsExactlyAsync<WebSocketException>(
            () => socket.ConnectAsync(new Uri($"{wsUrl}/ws?token=anything"), CancellationToken.None));
    }

    [TestMethod]
    public async Task WebSocket_WithoutToken_IsRejected()
    {
        using var socket = new ClientWebSocket();
        socket.Options.SetRequestHeader("Origin", baseUrl);

        await Assert.ThrowsExactlyAsync<WebSocketException>(
            () => socket.ConnectAsync(new Uri($"{wsUrl}/ws"), CancellationToken.None));
    }

    [TestMethod]
    public async Task WebSocket_WithValidTokenAndOrigin_Connects()
    {
        var token = (await PostPairAsync(CurrentPin(), "Testgerät")).Token!;

        using var socket = new ClientWebSocket();
        socket.Options.SetRequestHeader("Origin", baseUrl);
        await socket.ConnectAsync(new Uri($"{wsUrl}/ws?token={token}"), CancellationToken.None);

        Assert.AreEqual(WebSocketState.Open, socket.State);

        await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
    }

    [TestMethod]
    public async Task Unpair_WithoutBearerToken_IsUnauthorized()
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, "/pair");
        request.Headers.Add("Origin", baseUrl);

        var response = await httpClient.SendAsync(request);

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task Unpair_WithValidToken_RevokesTokenAndForceClosesOpenSocket()
    {
        var token = (await PostPairAsync(CurrentPin(), "Testgerät")).Token!;

        using var socket = new ClientWebSocket();
        socket.Options.SetRequestHeader("Origin", baseUrl);
        await socket.ConnectAsync(new Uri($"{wsUrl}/ws?token={token}"), CancellationToken.None);

        using var deleteRequest = new HttpRequestMessage(HttpMethod.Delete, "/pair");
        deleteRequest.Headers.Add("Origin", baseUrl);
        deleteRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var deleteResponse = await httpClient.SendAsync(deleteRequest);

        Assert.AreEqual(HttpStatusCode.NoContent, deleteResponse.StatusCode);
        Assert.IsTrue(await WaitForSocketToCloseAsync(socket), "Der Socket wurde nach dem Entkoppeln nicht beendet.");

        var statusAfterRemoval = await httpClient.GetFromJsonAsync<PairStatusResponse>(
            $"/pair/status?token={token}",
            JsonOptions);
        Assert.IsFalse(statusAfterRemoval!.Valid);
    }

    private string CurrentPin() => app.Services.GetRequiredService<PairingService>().GetCurrentPin().Pin;

    private string InvalidPin() => CurrentPin() == "000000" ? "111111" : "000000";

    private async Task<PairResponse> PostPairAsync(string pin, string deviceName)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/pair")
        {
            Content = JsonBody($$"""{"pin":"{{pin}}","deviceName":"{{deviceName}}"}""")
        };
        request.Headers.Add("Origin", baseUrl);

        var response = await httpClient.SendAsync(request);
        return (await response.Content.ReadFromJsonAsync<PairResponse>(JsonOptions))!;
    }

    private static async Task<bool> WaitForSocketToCloseAsync(ClientWebSocket socket)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var buffer = new byte[16];

        try
        {
            while (socket.State == WebSocketState.Open)
            {
                var result = await socket.ReceiveAsync(buffer, timeout.Token);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    return true;
                }
            }

            return true;
        }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException)
        {
            return socket.State != WebSocketState.Open;
        }
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
