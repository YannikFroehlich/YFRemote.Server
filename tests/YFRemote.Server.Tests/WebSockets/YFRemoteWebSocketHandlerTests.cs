using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using YFRemote.Server.Models;
using YFRemote.Server.Services;
using YFRemote.Server.WebSockets;

namespace YFRemote.Server.Tests.WebSockets;

[TestClass]
public sealed class YFRemoteWebSocketHandlerTests
{
    [TestMethod]
    public async Task HandleAsync_ValidAction_SendsSuccessResponseAndEchoesRequestId()
    {
        await using var pair = await WebSocketPair.CreateAsync();
        var handleTask = CreateHandler().HandleAsync(pair.Server, "test-client", CancellationToken.None);

        await SendTextAsync(pair.Client, """{"type":"key","keys":["ENTER"],"requestId":"r1"}""");
        var response = await ReceiveResponseAsync(pair.Client);

        Assert.IsTrue(response.Success, response.Error);
        Assert.AreEqual("r1", response.RequestId);

        await CloseClientAsync(pair.Client);
        await AwaitHandlerAsync(handleTask);
    }

    [TestMethod]
    public async Task HandleAsync_InvalidJson_SendsFailureResponse()
    {
        await using var pair = await WebSocketPair.CreateAsync();
        var handleTask = CreateHandler().HandleAsync(pair.Server, "test-client", CancellationToken.None);

        await SendTextAsync(pair.Client, "not-json");
        var response = await ReceiveResponseAsync(pair.Client);

        Assert.IsFalse(response.Success);
        Assert.AreEqual("Invalid JSON.", response.Error);

        await CloseClientAsync(pair.Client);
        await AwaitHandlerAsync(handleTask);
    }

    [TestMethod]
    public async Task HandleAsync_BinaryMessage_SendsFailureResponse()
    {
        await using var pair = await WebSocketPair.CreateAsync();
        var handleTask = CreateHandler().HandleAsync(pair.Server, "test-client", CancellationToken.None);

        await pair.Client.SendAsync(new byte[] { 1, 2, 3 }, WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);
        var response = await ReceiveResponseAsync(pair.Client);

        Assert.IsFalse(response.Success);
        Assert.AreEqual("Only text JSON messages are supported.", response.Error);

        await CloseClientAsync(pair.Client);
        await AwaitHandlerAsync(handleTask);
    }

    [TestMethod]
    public async Task HandleAsync_MessageExceedsMaxSize_SendsFailureResponse()
    {
        await using var pair = await WebSocketPair.CreateAsync();
        var handleTask = CreateHandler().HandleAsync(pair.Server, "test-client", CancellationToken.None);

        var oversizedText = $$"""{"type":"text","text":"{{new string('a', 20_000)}}"}""";
        await SendTextAsync(pair.Client, oversizedText);
        var response = await ReceiveResponseAsync(pair.Client);

        Assert.IsFalse(response.Success);
        Assert.AreEqual("Message is too large.", response.Error);

        await CloseClientAsync(pair.Client);
        await AwaitHandlerAsync(handleTask);
    }

    [TestMethod]
    public async Task HandleAsync_ClientClose_EndsHandlerLoop()
    {
        await using var pair = await WebSocketPair.CreateAsync();
        var handleTask = CreateHandler().HandleAsync(pair.Server, "test-client", CancellationToken.None);

        await pair.Client.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None);

        await AwaitHandlerAsync(handleTask);
    }

    [TestMethod]
    public async Task HandleAsync_ExceedsRateLimit_RejectsExtraMessage()
    {
        await using var pair = await WebSocketPair.CreateAsync();
        var timeProvider = new ManualTimeProvider(DateTimeOffset.UtcNow);
        var handleTask = CreateHandler(timeProvider: timeProvider).HandleAsync(pair.Server, "test-client", CancellationToken.None);

        RemoteActionResponse response = null!;
        for (var i = 0; i < YFRemoteWebSocketHandler.MaxMessagesPerRateLimitWindow + 1; i++)
        {
            await SendTextAsync(pair.Client, """{"type":"key","keys":["ENTER"]}""");
            response = await ReceiveResponseAsync(pair.Client);
        }

        Assert.IsFalse(response.Success);
        Assert.AreEqual("Rate limit exceeded.", response.Error);

        await CloseClientAsync(pair.Client);
        await AwaitHandlerAsync(handleTask);
    }

    [TestMethod]
    public async Task HandleAsync_RateLimitWindowElapsed_AllowsMessagesAgain()
    {
        await using var pair = await WebSocketPair.CreateAsync();
        var timeProvider = new ManualTimeProvider(DateTimeOffset.UtcNow);
        var handleTask = CreateHandler(timeProvider: timeProvider).HandleAsync(pair.Server, "test-client", CancellationToken.None);

        for (var i = 0; i < YFRemoteWebSocketHandler.MaxMessagesPerRateLimitWindow; i++)
        {
            await SendTextAsync(pair.Client, """{"type":"key","keys":["ENTER"]}""");
            await ReceiveResponseAsync(pair.Client);
        }

        timeProvider.Advance(TimeSpan.FromSeconds(2));

        await SendTextAsync(pair.Client, """{"type":"key","keys":["ENTER"]}""");
        var response = await ReceiveResponseAsync(pair.Client);

        Assert.IsTrue(response.Success, response.Error);

        await CloseClientAsync(pair.Client);
        await AwaitHandlerAsync(handleTask);
    }

    private static YFRemoteWebSocketHandler CreateHandler(
        IInputService? inputService = null,
        IMouseService? mouseService = null,
        TimeProvider? timeProvider = null)
    {
        var actionHandler = new RemoteActionHandler(
            inputService ?? new RecordingInputService(),
            mouseService ?? new RecordingMouseService(),
            NullLogger<RemoteActionHandler>.Instance);

        return new YFRemoteWebSocketHandler(
            actionHandler,
            timeProvider ?? TimeProvider.System,
            NullLogger<YFRemoteWebSocketHandler>.Instance);
    }

    private static Task SendTextAsync(WebSocket socket, string text) =>
        socket.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, endOfMessage: true, CancellationToken.None);

    private static async Task<RemoteActionResponse> ReceiveResponseAsync(WebSocket socket)
    {
        var buffer = new byte[8192];
        using var stream = new MemoryStream();

        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, CancellationToken.None);
            stream.Write(buffer, 0, result.Count);
            if (result.EndOfMessage)
            {
                break;
            }
        }

        return JsonSerializer.Deserialize<RemoteActionResponse>(stream.ToArray(), new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException("No response received.");
    }

    private static async Task CloseClientAsync(WebSocket socket)
    {
        if (socket.State == WebSocketState.Open)
        {
            await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
        }
    }

    private static async Task AwaitHandlerAsync(Task handleTask)
    {
        var winner = await Task.WhenAny(handleTask, Task.Delay(TimeSpan.FromSeconds(5)));
        Assert.AreSame(handleTask, winner, "HandleAsync did not complete in time.");
        await handleTask;
    }

    // Verbindet Client- und Server-WebSocket über ein echtes Loopback-TCP-Socketpaar, damit
    // HandleAsync über das reale WebSocket-Framing (inkl. Fragmentierung/Nachrichtengrenzen)
    // getestet werden kann statt gegen ein Fake.
    private sealed class WebSocketPair(TcpClient clientTcp, TcpClient serverTcp, WebSocket client, WebSocket server) : IAsyncDisposable
    {
        public WebSocket Client { get; } = client;

        public WebSocket Server { get; } = server;

        public static async Task<WebSocketPair> CreateAsync()
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();

            try
            {
                var port = ((IPEndPoint)listener.LocalEndpoint).Port;
                var acceptTask = listener.AcceptTcpClientAsync();
                var clientTcp = new TcpClient();
                await clientTcp.ConnectAsync(IPAddress.Loopback, port);
                var serverTcp = await acceptTask;

                var client = WebSocket.CreateFromStream(
                    clientTcp.GetStream(), isServer: false, subProtocol: null, keepAliveInterval: TimeSpan.Zero);
                var server = WebSocket.CreateFromStream(
                    serverTcp.GetStream(), isServer: true, subProtocol: null, keepAliveInterval: TimeSpan.Zero);

                return new WebSocketPair(clientTcp, serverTcp, client, server);
            }
            finally
            {
                listener.Stop();
            }
        }

        public ValueTask DisposeAsync()
        {
            Client.Dispose();
            Server.Dispose();
            clientTcp.Dispose();
            serverTcp.Dispose();
            return ValueTask.CompletedTask;
        }
    }

    private sealed class RecordingInputService : IInputService
    {
        public void PressKey(string key)
        {
        }

        public void PressHotkey(IReadOnlyList<string> keys)
        {
        }

        public void TypeText(string text)
        {
        }

        public void KeyDown(string key)
        {
        }

        public void KeyUp(string key)
        {
        }
    }

    private sealed class RecordingMouseService : IMouseService
    {
        public void MoveRelative(int deltaX, int deltaY)
        {
        }

        public void ClickLeft()
        {
        }

        public void ClickRight()
        {
        }

        public void ClickMiddle()
        {
        }

        public void ButtonDown(string button)
        {
        }

        public void ButtonUp(string button)
        {
        }

        public void Scroll(int delta)
        {
        }

        public void ScrollHorizontal(int delta)
        {
        }
    }

    private sealed class ManualTimeProvider(DateTimeOffset initialTime) : TimeProvider
    {
        private DateTimeOffset utcNow = initialTime;

        public override DateTimeOffset GetUtcNow() => utcNow;

        public void Advance(TimeSpan duration)
        {
            utcNow = utcNow.Add(duration);
        }
    }
}
