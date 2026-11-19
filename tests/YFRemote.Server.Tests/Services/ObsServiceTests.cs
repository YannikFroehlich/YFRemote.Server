using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using YFRemote.Server.Configuration;
using YFRemote.Server.Models;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

// Ein nachgebauter obs-websocket-v5-Server ueber echten WebSocket: so laufen Anmeldung,
// Batch-Abfrage und Befehle ohne installiertes OBS.
[TestClass]
public sealed class ObsServiceTests
{
    // Beispielwerte aus der obs-websocket-Dokumentation, Ergebnis unabhaengig mit Python berechnet.
    private const string Password = "supersecret";
    private const string Salt = "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=";
    private const string Challenge = "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=";
    private const string ExpectedAuthentication = "sQBlPUYd9mki/3XVFBp4Pt08FCMWdMVIqnFWdEitUME=";

    private string directory = null!;

    [TestInitialize]
    public void Initialize()
    {
        directory = Path.Combine(Path.GetTempPath(), "YFRemote.Server.Tests", Guid.NewGuid().ToString("N"));
    }

    [TestCleanup]
    public void Cleanup()
    {
        if (Directory.Exists(directory))
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    [TestMethod]
    public void CreateAuthentication_MatchesProtocol()
    {
        Assert.AreEqual(ExpectedAuthentication, ObsService.CreateAuthentication(Password, Salt, Challenge));
    }

    [TestMethod]
    public async Task ReadAsync_WithPasswordFromObs_ReadsScenesOutputsAndAudioInputs()
    {
        await using var obs = await FakeObs.StartAsync(Password);
        WriteConfig($$"""{"server_enabled":true,"server_port":{{obs.Port}},"auth_required":true,"server_password":"{{Password}}"}""");
        using var service = new ObsService(new ObsOptions { ConfigDirectory = directory }, NullLogger<ObsService>.Instance);

        var message = await service.ReadAsync();

        Assert.AreEqual("connected", message.State);
        CollectionAssert.AreEqual(new[] { "Live", "Pause" }, message.Scenes!.ToArray());
        Assert.AreEqual("Live", message.CurrentScene);
        Assert.IsTrue(message.Streaming);
        Assert.IsTrue(message.Recording);
        Assert.IsFalse(message.RecordPaused);
        CollectionAssert.AreEqual(new[] { new ObsInput("Mic/Aux", true) }, message.Inputs!.ToArray());

        // Die zweite Abfrage nutzt dieselbe Verbindung.
        Assert.AreEqual(message, await service.ReadAsync());
        Assert.AreEqual(1, obs.Connections);
    }

    [TestMethod]
    public async Task ReadAsync_WrongPassword_ReportsAuthFailed()
    {
        await using var obs = await FakeObs.StartAsync(Password);
        using var service = CreateService(obs.Port, "falsch");

        Assert.AreEqual("authFailed", (await service.ReadAsync()).State);
    }

    [TestMethod]
    public async Task ReadAsync_PasswordRequiredButUnknown_ReportsAuthFailed()
    {
        await using var obs = await FakeObs.StartAsync(Password);
        using var service = CreateService(obs.Port, password: null);

        Assert.AreEqual("authFailed", (await service.ReadAsync()).State);
    }

    [TestMethod]
    public async Task ReadAsync_NothingListening_ReportsOffline()
    {
        using var service = CreateService(GetFreeTcpPort(), password: null);

        Assert.AreEqual("offline", (await service.ReadAsync()).State);
    }

    [TestMethod]
    public async Task ReadAsync_ServerDisabledInObs_ReportsDisabled()
    {
        WriteConfig("""{"server_enabled":false}""");
        using var service = new ObsService(new ObsOptions { ConfigDirectory = directory }, NullLogger<ObsService>.Instance);

        Assert.AreEqual(new ObsMessage("disabled"), await service.ReadAsync());
    }

    [TestMethod]
    public async Task SendAsync_ForwardsRequestAndReportsRejection()
    {
        await using var obs = await FakeObs.StartAsync(password: null);
        using var service = CreateService(obs.Port, password: null);

        await service.SendAsync("SetCurrentProgramScene", new JsonObject { ["sceneName"] = "Pause" });
        var rejected = await Assert.ThrowsExactlyAsync<NotSupportedException>(() =>
            service.SendAsync("SetCurrentProgramScene", new JsonObject { ["sceneName"] = "Fehlt" }));

        Assert.AreEqual("SetCurrentProgramScene {\"sceneName\":\"Pause\"}", obs.Requests[0]);
        Assert.AreEqual("OBS: No source was found by the name of `Fehlt`.", rejected.Message);
    }

    [TestMethod]
    public async Task SendAsync_NothingListening_ThrowsNotReachable()
    {
        using var service = CreateService(GetFreeTcpPort(), password: null);

        var exception = await Assert.ThrowsExactlyAsync<NotSupportedException>(() => service.SendAsync("ToggleStream"));

        Assert.AreEqual(ObsService.NotReachableError, exception.Message);
    }

    private ObsService CreateService(int port, string? password) =>
        new(new ObsOptions { ConfigDirectory = directory, Port = port, Password = password }, NullLogger<ObsService>.Instance);

    private void WriteConfig(string json)
    {
        var folder = Path.Combine(directory, "plugin_config", "obs-websocket");
        Directory.CreateDirectory(folder);
        File.WriteAllText(Path.Combine(folder, "config.json"), json);
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

    private sealed class FakeObs(WebApplication app, int port, string? password) : IAsyncDisposable
    {
        private int connections;

        public int Port => port;

        public int Connections => connections;

        public List<string> Requests { get; } = [];

        public static async Task<FakeObs> StartAsync(string? password)
        {
            var port = GetFreeTcpPort();
            var builder = WebApplication.CreateSlimBuilder();
            builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
            builder.Logging.ClearProviders();
            var app = builder.Build();
            var fake = new FakeObs(app, port, password);
            app.UseWebSockets();
            app.Run(async context =>
            {
                if (!context.WebSockets.IsWebSocketRequest)
                {
                    context.Response.StatusCode = StatusCodes.Status400BadRequest;
                    return;
                }

                using var socket = await context.WebSockets.AcceptWebSocketAsync("obswebsocket.json");
                await fake.ServeAsync(socket);
            });
            await app.StartAsync();
            return fake;
        }

        public async ValueTask DisposeAsync()
        {
            await app.StopAsync();
            await app.DisposeAsync();
        }

        private async Task ServeAsync(WebSocket socket)
        {
            Interlocked.Increment(ref connections);
            var hello = new JsonObject { ["obsWebSocketVersion"] = "5.5.0", ["rpcVersion"] = 1 };
            if (password is not null)
            {
                hello["authentication"] = new JsonObject { ["challenge"] = Challenge, ["salt"] = Salt };
            }

            await SendAsync(socket, 0, hello);
            var identify = await ReceiveAsync(socket);
            if (identify?["op"]?.GetValue<int>() != 1
                || (password is not null && identify["d"]?["authentication"]?.GetValue<string>() != ExpectedAuthentication))
            {
                await socket.CloseOutputAsync((WebSocketCloseStatus)4009, "Authentication failed.", CancellationToken.None);
                return;
            }

            await SendAsync(socket, 2, new JsonObject { ["negotiatedRpcVersion"] = 1 });
            while (await ReceiveAsync(socket) is { } message)
            {
                var data = message["d"]!.AsObject();
                if (message["op"]!.GetValue<int>() == 6)
                {
                    var type = data["requestType"]!.GetValue<string>();
                    Requests.Add($"{type} {data["requestData"]?.ToJsonString()}");
                    await SendAsync(socket, 7, Answer(type, data["requestData"], data["requestId"]!.GetValue<string>()));
                }
                else
                {
                    var results = new JsonArray();
                    foreach (var request in data["requests"]!.AsArray())
                    {
                        results.Add(Answer(request!["requestType"]!.GetValue<string>(), request["requestData"], null));
                    }

                    await SendAsync(socket, 9, new JsonObject { ["requestId"] = data["requestId"]!.GetValue<string>(), ["results"] = results });
                }
            }
        }

        private static JsonObject Answer(string type, JsonNode? requestData, string? requestId)
        {
            JsonNode? responseData = type switch
            {
                "GetSceneList" => JsonNode.Parse("""{"currentProgramSceneName":"Live","scenes":[{"sceneIndex":0,"sceneName":"Pause"},{"sceneIndex":1,"sceneName":"Live"}]}"""),
                "GetStreamStatus" => JsonNode.Parse("""{"outputActive":true}"""),
                "GetRecordStatus" => JsonNode.Parse("""{"outputActive":true,"outputPaused":false}"""),
                "GetInputList" => JsonNode.Parse("""{"inputs":[{"inputName":"Mic/Aux"},{"inputName":"Webcam"}]}"""),
                "GetInputMute" when requestData?["inputName"]?.GetValue<string>() == "Mic/Aux" => JsonNode.Parse("""{"inputMuted":true}"""),
                _ => null
            };
            var failed = type == "GetInputMute" && responseData is null
                || requestData?["sceneName"]?.GetValue<string>() == "Fehlt";
            var status = new JsonObject { ["result"] = !failed, ["code"] = failed ? 600 : 100 };
            if (failed)
            {
                status["comment"] = $"No source was found by the name of `{requestData?["sceneName"] ?? requestData?["inputName"]}`.";
            }

            return new JsonObject
            {
                ["requestType"] = type,
                ["requestId"] = requestId,
                ["requestStatus"] = status,
                ["responseData"] = responseData
            };
        }

        private static Task SendAsync(WebSocket socket, int op, JsonObject data) =>
            socket.SendAsync(
                Encoding.UTF8.GetBytes(new JsonObject { ["op"] = op, ["d"] = data }.ToJsonString()),
                WebSocketMessageType.Text,
                endOfMessage: true,
                CancellationToken.None);

        private static async Task<JsonNode?> ReceiveAsync(WebSocket socket)
        {
            var buffer = new byte[64 * 1024];
            try
            {
                var result = await socket.ReceiveAsync(buffer, CancellationToken.None);
                return result.MessageType == WebSocketMessageType.Close
                    ? null
                    : JsonNode.Parse(buffer.AsSpan(0, result.Count));
            }
            catch (WebSocketException)
            {
                return null;
            }
        }
    }
}
