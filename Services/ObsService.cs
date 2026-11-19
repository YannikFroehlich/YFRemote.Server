using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using YFRemote.Server.Configuration;
using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Spricht obs-websocket v5 (in OBS ab Version 28 eingebaut) auf localhost - das Handy kommt nie
// direkt an OBS und dessen Passwort. Eine Verbindung fuer alles und ohne Ereignisse: der Tab fragt
// wie bei Voicemeeter sekuendlich ab, ein Befehl wartet auf seine Antwort.
public sealed class ObsService(ObsOptions options, ILogger<ObsService> logger) : IObsService, IDisposable
{
    internal const string NotReachableError = "OBS is not reachable.";
    internal const string AuthenticationFailedError = "OBS rejected the password.";

    private const int AuthenticationFailedCloseCode = 4009;
    private const int RpcVersion = 1;
    internal const double MinVolumeDb = -100;
    internal const double MaxVolumeDb = 26;
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(3);

    private readonly SemaphoreSlim gate = new(1, 1);
    private ClientWebSocket? socket;
    private ObsConnectionSettings? connectedWith;
    private int requestCounter;

    public bool IsInstalled => options.Port is not null || Directory.Exists(options.ConfigDirectory);

    public async Task<ObsMessage> ReadAsync()
    {
        await gate.WaitAsync();
        try
        {
            var settings = options.Resolve();
            if (!settings.Enabled)
            {
                Drop();
                return new ObsMessage("disabled");
            }

            using var timeout = new CancellationTokenSource(RequestTimeout);
            await EnsureConnectedAsync(settings, timeout.Token);

            var status = await BatchAsync(
                [
                    Request("GetSceneList"),
                    Request("GetStreamStatus"),
                    Request("GetRecordStatus"),
                    Request("GetInputList"),
                    Request("GetReplayBufferStatus"),
                    Request("GetVirtualCamStatus")
                ],
                timeout.Token);
            var sceneList = ResponseData(status, 0);
            var stream = ResponseData(status, 1);
            var record = ResponseData(status, 2);
            var inputNames = (ResponseData(status, 3)?["inputs"] as JsonArray ?? new JsonArray())
                .Select(input => Text(input?["inputName"]))
                .OfType<string>()
                .ToList();
            var currentScene = Text(sceneList?["currentProgramSceneName"]);

            // Zweite Runde: je Quelle Stummschaltung und Lautstaerke, dazu die Quellen der aktuellen
            // Szene. Nur Quellen mit Ton beantworten GetInputMute; Bild-, Text- und Browserquellen
            // fallen so heraus.
            List<JsonObject> details = [];
            foreach (var name in inputNames)
            {
                details.Add(Request("GetInputMute", new JsonObject { ["inputName"] = name }));
                details.Add(Request("GetInputVolume", new JsonObject { ["inputName"] = name }));
            }

            if (currentScene is not null)
            {
                details.Add(Request("GetSceneItemList", new JsonObject { ["sceneName"] = currentScene }));
            }

            var answers = details.Count == 0 ? new JsonArray() : await BatchAsync(details, timeout.Token);
            var inputs = inputNames
                .Select((name, index) => ResponseData(answers, 2 * index) is { } mute
                    ? new ObsInput(
                        name,
                        Flag(mute["inputMuted"]),
                        // Stumm geregelt ist -inf dB, das JSON als null schickt.
                        Math.Round(Math.Max(MinVolumeDb, Real(ResponseData(answers, 2 * index + 1)?["inputVolumeDb"]) ?? MinVolumeDb), 1))
                    : null)
                .OfType<ObsInput>()
                .ToList();
            // Wie die Szenen: sceneItemIndex zaehlt von unten, oben in OBS steht der hoechste.
            var sources = currentScene is null
                ? null
                : (ResponseData(answers, 2 * inputNames.Count)?["sceneItems"] as JsonArray ?? new JsonArray())
                    .OrderByDescending(item => Number(item?["sceneItemIndex"]))
                    .Select(item => Text(item?["sourceName"]) is { } name
                        ? new ObsSceneItem(Number(item!["sceneItemId"]), name, Flag(item["sceneItemEnabled"]))
                        : null)
                    .OfType<ObsSceneItem>()
                    .ToList();

            // GetSceneList liefert die unterste Szene zuerst; sceneIndex zaehlt von unten.
            var scenes = (sceneList?["scenes"] as JsonArray ?? new JsonArray())
                .OrderByDescending(scene => Number(scene?["sceneIndex"]))
                .Select(scene => Text(scene?["sceneName"]))
                .OfType<string>()
                .ToList();

            // Ohne eingeschalteten Wiederholungspuffer bzw. virtuelle Kamera lehnt OBS die Abfrage ab: null.
            var replayBuffer = ResponseData(status, 4);
            var virtualCam = ResponseData(status, 5);
            return new ObsMessage(
                "connected",
                scenes,
                currentScene,
                Flag(stream?["outputActive"]),
                Flag(record?["outputActive"]),
                Flag(record?["outputPaused"]),
                inputs,
                Seconds(stream),
                Seconds(record),
                replayBuffer is null ? null : Flag(replayBuffer["outputActive"]),
                virtualCam is null ? null : Flag(virtualCam["outputActive"]),
                sources);
        }
        catch (ObsAuthenticationException)
        {
            Drop();
            return new ObsMessage("authFailed");
        }
        catch (Exception exception) when (IsConnectionFailure(exception))
        {
            logger.LogDebug(exception, "OBS is not reachable.");
            Drop();
            return new ObsMessage("offline");
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task SendAsync(string requestType, JsonObject? requestData = null)
    {
        await gate.WaitAsync();
        try
        {
            var settings = options.Resolve();
            if (!settings.Enabled)
            {
                throw new NotSupportedException(NotReachableError);
            }

            using var timeout = new CancellationTokenSource(RequestTimeout);
            await EnsureConnectedAsync(settings, timeout.Token);

            var id = NextRequestId();
            var request = Request(requestType, requestData);
            request["requestId"] = id;
            await SendMessageAsync(socket!, 6, request, timeout.Token);
            var response = await ReceiveResponseAsync(7, id, timeout.Token);
            var requestStatus = response["requestStatus"];
            if (!Flag(requestStatus?["result"]))
            {
                // Zu diesen Codes schickt obs-websocket keinen Text mit.
                throw new NotSupportedException("OBS: " + (Text(requestStatus?["comment"]) ?? Number(requestStatus?["code"]) switch
                {
                    500 => "already running.",
                    501 => "not running.",
                    502 => "already paused.",
                    503 => "not paused.",
                    var code => $"error {code}."
                }));
            }
        }
        catch (ObsAuthenticationException)
        {
            Drop();
            throw new NotSupportedException(AuthenticationFailedError);
        }
        catch (Exception exception) when (IsConnectionFailure(exception))
        {
            logger.LogDebug(exception, "OBS request {RequestType} failed.", requestType);
            Drop();
            throw new NotSupportedException(NotReachableError);
        }
        finally
        {
            gate.Release();
        }
    }

    public void Dispose()
    {
        Drop();
        gate.Dispose();
    }

    internal static string CreateAuthentication(string password, string salt, string challenge)
    {
        var secret = Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(password + salt)));
        return Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(secret + challenge)));
    }

    // Hello (op 0) -> Identify (op 1) -> Identified (op 2). Ein falsches Passwort beantwortet OBS
    // mit dem Schliesscode 4009.
    private async Task EnsureConnectedAsync(ObsConnectionSettings settings, CancellationToken cancellationToken)
    {
        if (socket?.State == WebSocketState.Open && connectedWith == settings)
        {
            return;
        }

        Drop();
        var next = new ClientWebSocket();
        next.Options.AddSubProtocol("obswebsocket.json");
        try
        {
            await next.ConnectAsync(new Uri($"ws://127.0.0.1:{settings.Port}"), cancellationToken);
            var hello = await ReceiveMessageAsync(next, cancellationToken);
            if (Number(hello["op"]) != 0)
            {
                throw new WebSocketException("OBS did not send Hello.");
            }

            var identify = new JsonObject { ["rpcVersion"] = RpcVersion, ["eventSubscriptions"] = 0 };
            if (hello["d"]?["authentication"] is JsonObject authentication)
            {
                if (settings.Password is null)
                {
                    throw new ObsAuthenticationException();
                }

                identify["authentication"] = CreateAuthentication(
                    settings.Password,
                    Text(authentication["salt"]) ?? "",
                    Text(authentication["challenge"]) ?? "");
            }

            await SendMessageAsync(next, 1, identify, cancellationToken);
            if (Number((await ReceiveMessageAsync(next, cancellationToken))["op"]) != 2)
            {
                throw new WebSocketException("OBS did not confirm Identify.");
            }

            logger.LogInformation("Connected to OBS on port {Port}.", settings.Port);
            socket = next;
            connectedWith = settings;
        }
        catch
        {
            next.Dispose();
            throw;
        }
    }

    private async Task<JsonArray> BatchAsync(IEnumerable<JsonObject> requests, CancellationToken cancellationToken)
    {
        var id = NextRequestId();
        await SendMessageAsync(socket!, 8, new JsonObject
        {
            ["requestId"] = id,
            ["haltOnFailure"] = false,
            ["requests"] = new JsonArray([.. requests])
        }, cancellationToken);
        return (await ReceiveResponseAsync(9, id, cancellationToken))["results"] as JsonArray ?? new JsonArray();
    }

    // Eine Antwort auf eine abgebrochene fruehere Anfrage kann noch unterwegs sein - die wird uebersprungen.
    private async Task<JsonObject> ReceiveResponseAsync(int op, string requestId, CancellationToken cancellationToken)
    {
        while (true)
        {
            var message = await ReceiveMessageAsync(socket!, cancellationToken);
            if (Number(message["op"]) == op
                && message["d"] is JsonObject data
                && Text(data["requestId"]) == requestId)
            {
                return data;
            }
        }
    }

    private static async Task SendMessageAsync(
        ClientWebSocket target,
        int op,
        JsonObject data,
        CancellationToken cancellationToken)
    {
        var bytes = Encoding.UTF8.GetBytes(new JsonObject { ["op"] = op, ["d"] = data }.ToJsonString());
        await target.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, cancellationToken);
    }

    private static async Task<JsonObject> ReceiveMessageAsync(ClientWebSocket source, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        WebSocketReceiveResult result;
        do
        {
            result = await source.ReceiveAsync(chunk, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                throw (int?)source.CloseStatus == AuthenticationFailedCloseCode
                    ? new ObsAuthenticationException()
                    : (Exception)new WebSocketException($"OBS closed the connection: {source.CloseStatusDescription}");
            }

            buffer.Write(chunk, 0, result.Count);
        }
        while (!result.EndOfMessage);

        return JsonNode.Parse(buffer.ToArray()) as JsonObject
            ?? throw new JsonException("OBS sent no JSON object.");
    }

    // requestData nur, wenn es eins gibt - obs-websocket erwartet dort ein Objekt.
    private static JsonObject Request(string requestType, JsonObject? requestData = null)
    {
        var request = new JsonObject { ["requestType"] = requestType };
        if (requestData is not null)
        {
            request["requestData"] = requestData;
        }

        return request;
    }

    private static JsonNode? ResponseData(JsonArray results, int index) =>
        index < results.Count && Flag(results[index]?["requestStatus"]?["result"])
            ? results[index]?["responseData"]
            : null;

    private static string? Text(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;

    private static bool Flag(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<bool>(out var flag) && flag;

    private static int Number(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<int>(out var number) ? number : -1;

    private static double? Real(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<double>(out var number) ? number : null;

    // Laufzeit einer Ausgabe in ganzen Sekunden, nur solange sie laeuft.
    private static int? Seconds(JsonNode? output) =>
        Flag(output?["outputActive"]) ? Math.Max(0, Number(output?["outputDuration"])) / 1000 : null;

    private static bool IsConnectionFailure(Exception exception) =>
        exception is WebSocketException or OperationCanceledException or IOException or JsonException
            or InvalidOperationException or ObjectDisposedException;

    private string NextRequestId() => Interlocked.Increment(ref requestCounter).ToString(System.Globalization.CultureInfo.InvariantCulture);

    private void Drop()
    {
        socket?.Abort();
        socket?.Dispose();
        socket = null;
        connectedWith = null;
    }

    private sealed class ObsAuthenticationException : Exception;
}
