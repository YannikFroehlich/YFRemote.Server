using System.Buffers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using YFRemote.Server.Models;
using YFRemote.Server.Services;

namespace YFRemote.Server.WebSockets;

public sealed class YFRemoteWebSocketHandler(
    RemoteActionHandler actionHandler,
    ILogger<YFRemoteWebSocketHandler> logger)
{
    private const int BufferSize = 4096;
    private const int MaxMessageBytes = 16 * 1024;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNameCaseInsensitive = true
    };

    public async Task HandleAsync(WebSocket socket, string client, CancellationToken cancellationToken)
    {
        logger.LogInformation("WebSocket client connected: {Client}", client);

        try
        {
            while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            {
                var receivedMessage = await ReceiveMessageAsync(socket, cancellationToken);
                if (receivedMessage is null)
                {
                    break;
                }

                var response = receivedMessage.ErrorResponse
                    ?? HandleMessage(receivedMessage.Payload!.Value);

                await SendResponseAsync(socket, response, cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            logger.LogInformation("WebSocket client cancelled: {Client}", client);
        }
        catch (WebSocketException ex)
        {
            logger.LogWarning(ex, "WebSocket client error: {Client}", client);
        }
        finally
        {
            logger.LogInformation("WebSocket client disconnected: {Client}", client);
        }
    }

    private RemoteActionResponse HandleMessage(ReadOnlyMemory<byte> message)
    {
        var json = Encoding.UTF8.GetString(message.Span);
        logger.LogDebug("Received WebSocket action payload: {Payload}", json);

        try
        {
            var request = JsonSerializer.Deserialize<RemoteActionRequest>(json, JsonOptions);
            var response = actionHandler.Handle(request);

            if (response.Success)
            {
                logger.LogDebug("WebSocket action succeeded.");
            }
            else
            {
                logger.LogWarning("WebSocket action failed: {Error}", response.Error);
            }

            return response;
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "Invalid WebSocket JSON payload.");
            return RemoteActionResponse.Fail("Invalid JSON.");
        }
    }

    private static async Task<ReceivedMessage?> ReceiveMessageAsync(
        WebSocket socket,
        CancellationToken cancellationToken)
    {
        var buffer = new byte[BufferSize];
        var writer = new ArrayBufferWriter<byte>();

        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, cancellationToken);

            if (result.MessageType == WebSocketMessageType.Close)
            {
                if (socket.State is WebSocketState.CloseReceived or WebSocketState.Open)
                {
                    await socket.CloseAsync(
                        WebSocketCloseStatus.NormalClosure,
                        "Closing",
                        cancellationToken);
                }

                return null;
            }

            if (result.MessageType != WebSocketMessageType.Text)
            {
                await DrainMessageAsync(socket, result, buffer, cancellationToken);
                return ReceivedMessage.Fail("Only text JSON messages are supported.");
            }

            if (writer.WrittenCount + result.Count > MaxMessageBytes)
            {
                await DrainMessageAsync(socket, result, buffer, cancellationToken);
                return ReceivedMessage.Fail("Message is too large.");
            }

            writer.Write(buffer.AsSpan(0, result.Count));

            if (result.EndOfMessage)
            {
                return ReceivedMessage.Ok(writer.WrittenMemory);
            }
        }
    }

    private static async Task DrainMessageAsync(
        WebSocket socket,
        WebSocketReceiveResult currentResult,
        byte[] buffer,
        CancellationToken cancellationToken)
    {
        var result = currentResult;
        while (!result.EndOfMessage && socket.State == WebSocketState.Open)
        {
            result = await socket.ReceiveAsync(buffer, cancellationToken);
        }
    }

    private static Task SendResponseAsync(
        WebSocket socket,
        RemoteActionResponse response,
        CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(response, JsonOptions);
        var bytes = Encoding.UTF8.GetBytes(json);

        return socket.SendAsync(
            bytes,
            WebSocketMessageType.Text,
            endOfMessage: true,
            cancellationToken);
    }

    private sealed record ReceivedMessage(
        ReadOnlyMemory<byte>? Payload,
        RemoteActionResponse? ErrorResponse)
    {
        public static ReceivedMessage Ok(ReadOnlyMemory<byte> payload) => new(payload, null);

        public static ReceivedMessage Fail(string error) => new(null, RemoteActionResponse.Fail(error));
    }
}
