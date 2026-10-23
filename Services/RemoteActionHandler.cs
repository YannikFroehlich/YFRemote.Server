using System.Text.RegularExpressions;
using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

public sealed partial class RemoteActionHandler(
    IInputService inputService,
    IMouseService mouseService,
    IPowerService powerService,
    ILogger<RemoteActionHandler> logger,
    IGamepadService? gamepadService = null,
    PollingBroadcaster<ClipboardMessage?>? clipboardSync = null,
    ClipboardReadNotifier? clipboardReadNotifier = null,
    IVolumeService? volumeService = null,
    ShutdownTimer? shutdownTimer = null,
    PollingBroadcaster<SystemStatsMessage>? systemStats = null,
    IVoicemeeterService? voicemeeter = null,
    PollingBroadcaster<VoicemeeterMessage>? voicemeeterStatus = null)
{
    private const int MaxShutdownTimerMinutes = 24 * 60;
    private const int MinMouseMoveDelta = -5000;
    private const int MaxMouseMoveDelta = 5000;
    private const int MinMouseScrollDelta = -1200;
    private const int MaxMouseScrollDelta = 1200;
    private const int MaxTextLength = 500;

    public RemoteActionResponse Handle(RemoteActionRequest? request, RemoteActionSession? session = null)
    {
        if (request is null)
        {
            return Fail("Invalid action payload.");
        }

        var type = request.Type?.Trim().ToLowerInvariant();
        var keys = NormalizeKeys(request.Keys);
        RemoteActionResponse response;

        try
        {
            response = type switch
            {
                "key" => HandleKey(keys),
                "hotkey" => HandleHotkey(keys),
                "text" => HandleText(request),
                "mousemove" => HandleMouseMove(request),
                "mouseclick" => HandleMouseClick(request),
                "mousedown" => HandleMouseButton(request, isDown: true),
                "mouseup" => HandleMouseButton(request, isDown: false),
                "mousescroll" => HandleMouseScroll(request),
                "shutdown" => HandlePower(powerService.Shutdown, "shutdown"),
                "restart" => HandlePower(powerService.Restart, "restart"),
                "sleep" => HandlePower(powerService.Sleep, "sleep"),
                "lock" => HandlePower(powerService.Lock, "lock"),
                "displayoff" => HandlePower(powerService.TurnOffDisplay, "displayOff"),
                "shutdowntimer" => HandleShutdownTimer(request, session),
                "volume" => HandleVolume(request),
                "gamepad" => HandleGamepad(request, session),
                "gamepaddisconnect" => HandleGamepadDisconnect(session),
                "clipboardsync" => HandleClipboardSync(request, session),
                "systemstats" => HandleSystemStats(request, session),
                "voicemeeter" => HandleVoicemeeterWatch(request, session),
                "voicemeeterparameter" => HandleVoicemeeterParameter(request),
                null or "" => Fail("Missing action type."),
                _ => Fail($"Unsupported action type: {request.Type}")
            };
        }
        catch (UnsupportedKeyException ex)
        {
            response = Fail(ex.Message);
        }
        catch (GamepadUnavailableException ex)
        {
            response = Fail(ex.Message);
        }
        catch (NotSupportedException ex)
        {
            response = Fail(ex.Message);
        }
        catch (InputBlockedException ex)
        {
            response = Fail(ex.Message);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Action {ActionType} failed.", request.Type);
            response = Fail("Action failed.");
        }

        return response with { RequestId = request.RequestId };
    }

    private RemoteActionResponse HandleKey(IReadOnlyList<string> keys)
    {
        if (keys.Count != 1)
        {
            return Fail("Action 'key' requires exactly one key.");
        }

        logger.LogDebug("Executing key action: {Key}", keys[0]);
        if (keys[0] is "VOLUME_MUTE" or "VOLUME_UP" or "VOLUME_DOWN"
            && volumeService?.TryHandleVolumeKey(keys[0]) == true)
        {
            logger.LogDebug("Volume key handled by the audio mixer instead of the OS.");
            return RemoteActionResponse.Ok();
        }

        inputService.PressKey(keys[0]);
        logger.LogDebug("Key action succeeded: {Key}", keys[0]);

        return RemoteActionResponse.Ok();
    }

    private RemoteActionResponse HandleHotkey(IReadOnlyList<string> keys)
    {
        if (keys.Count < 2)
        {
            return Fail("Action 'hotkey' requires at least two keys.");
        }

        if (keys.Distinct(StringComparer.OrdinalIgnoreCase).Count() != keys.Count)
        {
            return Fail("Hotkey keys must be distinct.");
        }

        logger.LogDebug("Executing hotkey action: {Keys}", string.Join("+", keys));
        inputService.PressHotkey(keys);
        logger.LogDebug("Hotkey action succeeded: {Keys}", string.Join("+", keys));

        return RemoteActionResponse.Ok();
    }

    private RemoteActionResponse HandleText(RemoteActionRequest request)
    {
        var text = request.Text;

        if (string.IsNullOrEmpty(text))
        {
            return Fail("Action 'text' requires text.");
        }

        if (text.Length > MaxTextLength)
        {
            return Fail($"text must be at most {MaxTextLength} characters.");
        }

        // Nur die Länge loggen, nicht den Inhalt: der Text kann beliebige, ggf. sensible
        // Nutzereingaben enthalten.
        logger.LogDebug("Executing text action with {Length} characters.", text.Length);
        inputService.TypeText(text);
        logger.LogDebug("Text action succeeded.");

        return RemoteActionResponse.Ok();
    }

    private RemoteActionResponse HandleMouseMove(RemoteActionRequest request)
    {
        if (request.DeltaX is null || request.DeltaY is null)
        {
            return Fail("Action 'mouseMove' requires deltaX and deltaY.");
        }

        if (!IsInRange(request.DeltaX.Value, MinMouseMoveDelta, MaxMouseMoveDelta))
        {
            return Fail($"deltaX must be between {MinMouseMoveDelta} and {MaxMouseMoveDelta}.");
        }

        if (!IsInRange(request.DeltaY.Value, MinMouseMoveDelta, MaxMouseMoveDelta))
        {
            return Fail($"deltaY must be between {MinMouseMoveDelta} and {MaxMouseMoveDelta}.");
        }

        logger.LogTrace(
            "Executing mouseMove action: deltaX={DeltaX}, deltaY={DeltaY}",
            request.DeltaX.Value,
            request.DeltaY.Value);

        mouseService.MoveRelative(request.DeltaX.Value, request.DeltaY.Value);

        return RemoteActionResponse.Ok();
    }

    private RemoteActionResponse HandleMouseClick(RemoteActionRequest request)
    {
        var button = request.Button?.Trim().ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(button))
        {
            return Fail("Action 'mouseClick' requires button.");
        }

        switch (button)
        {
            case "left":
                logger.LogDebug("Executing mouseClick action: left");
                mouseService.ClickLeft();
                logger.LogDebug("Mouse left click succeeded.");
                return RemoteActionResponse.Ok();

            case "right":
                logger.LogDebug("Executing mouseClick action: right");
                mouseService.ClickRight();
                logger.LogDebug("Mouse right click succeeded.");
                return RemoteActionResponse.Ok();

            case "middle":
                logger.LogDebug("Executing mouseClick action: middle");
                mouseService.ClickMiddle();
                logger.LogDebug("Mouse middle click succeeded.");
                return RemoteActionResponse.Ok();

            default:
                return Fail($"Unsupported mouse button: {request.Button}");
        }
    }

    private RemoteActionResponse HandleMouseButton(RemoteActionRequest request, bool isDown)
    {
        var actionName = isDown ? "mouseDown" : "mouseUp";
        var button = request.Button?.Trim().ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(button))
        {
            return Fail($"Action '{actionName}' requires button.");
        }

        if (button is not ("left" or "right" or "middle"))
        {
            return Fail($"Unsupported mouse button: {request.Button}");
        }

        logger.LogDebug("Executing {Action} action: {Button}", actionName, button);

        if (isDown)
        {
            mouseService.ButtonDown(button);
        }
        else
        {
            mouseService.ButtonUp(button);
        }

        logger.LogDebug("Mouse {Button} {Action} succeeded.", button, actionName);

        return RemoteActionResponse.Ok();
    }

    private RemoteActionResponse HandleMouseScroll(RemoteActionRequest request)
    {
        if (request.Delta is null && request.DeltaX is null)
        {
            return Fail("Action 'mouseScroll' requires delta or deltaX.");
        }

        if (request.Delta is not null && !IsInRange(request.Delta.Value, MinMouseScrollDelta, MaxMouseScrollDelta))
        {
            return Fail($"delta must be between {MinMouseScrollDelta} and {MaxMouseScrollDelta}.");
        }

        if (request.DeltaX is not null && !IsInRange(request.DeltaX.Value, MinMouseScrollDelta, MaxMouseScrollDelta))
        {
            return Fail($"deltaX must be between {MinMouseScrollDelta} and {MaxMouseScrollDelta}.");
        }

        if (request.Delta is not null)
        {
            logger.LogTrace("Executing mouseScroll action: delta={Delta}", request.Delta.Value);
            mouseService.Scroll(request.Delta.Value);
        }

        if (request.DeltaX is not null)
        {
            logger.LogTrace("Executing mouseScroll action: deltaX={DeltaX}", request.DeltaX.Value);
            mouseService.ScrollHorizontal(request.DeltaX.Value);
        }

        return RemoteActionResponse.Ok();
    }

    private RemoteActionResponse HandlePower(Action execute, string actionName)
    {
        // Absichtlich auf Information-Level: ein Herunterfahren aendert den Rechnerzustand und
        // soll im Standardprotokoll auffindbar sein, anders als normale Tasten-/Mausaktionen.
        logger.LogInformation("Executing power action: {Action}", actionName);
        execute();

        return RemoteActionResponse.Ok();
    }

    // minutes 0 bricht einen geplanten Termin ab.
    private RemoteActionResponse HandleShutdownTimer(RemoteActionRequest request, RemoteActionSession? session)
    {
        if (shutdownTimer is null)
        {
            return Fail("Shutdown timer is not supported.");
        }

        if (request.Minutes is not { } minutes || !IsInRange(minutes, 0, MaxShutdownTimerMinutes))
        {
            return Fail($"Action 'shutdownTimer' requires minutes between 0 and {MaxShutdownTimerMinutes}.");
        }

        var deviceName = session?.DeviceName ?? "Unbekanntes Gerät";
        if (minutes == 0)
        {
            shutdownTimer.Cancel(deviceName);
        }
        else
        {
            shutdownTimer.Schedule(TimeSpan.FromMinutes(minutes), deviceName);
        }

        return RemoteActionResponse.Ok();
    }

    private RemoteActionResponse HandleVolume(RemoteActionRequest request)
    {
        if (volumeService is null)
        {
            return Fail("Setting the volume is not supported.");
        }

        if (request.Volume is not { } volume || !IsInRange(volume, 0, 100))
        {
            return Fail("Action 'volume' requires volume between 0 and 100.");
        }

        logger.LogDebug("Setting volume to {Volume}.", volume);
        volumeService.SetVolume(volume);

        return RemoteActionResponse.Ok();
    }

    private RemoteActionResponse HandleGamepad(RemoteActionRequest request, RemoteActionSession? session)
    {
        if (gamepadService is null || session is null)
        {
            return Fail("Gamepad is not supported.");
        }

        if (request.Gamepad is null)
        {
            return Fail("Action 'gamepad' requires gamepad.");
        }

        // Erst mit dem ersten Controller-Zustand anstecken, nicht schon beim Verbinden: sonst
        // saehen Spiele fuer jedes Geraet im Maus- oder Tastaturmodus einen Controller.
        session.Gamepad ??= gamepadService.Connect(session.Rumble);
        session.Gamepad.Update(request.Gamepad);

        return RemoteActionResponse.Ok();
    }

    private static RemoteActionResponse HandleGamepadDisconnect(RemoteActionSession? session)
    {
        session?.DisconnectGamepad();
        return RemoteActionResponse.Ok();
    }

    private RemoteActionResponse HandleClipboardSync(RemoteActionRequest request, RemoteActionSession? session)
    {
        if (clipboardSync is null || session is null)
        {
            return Fail("Clipboard sync is not supported.");
        }

        if (request.Enabled is not { } enabled)
        {
            return Fail("Action 'clipboardSync' requires enabled.");
        }

        if (!enabled)
        {
            session.ClipboardSubscription?.Dispose();
            session.ClipboardSubscription = null;
            return RemoteActionResponse.Ok();
        }

        if (session.ClipboardSubscription is null)
        {
            session.ClipboardSubscription = clipboardSync.Subscribe(message =>
            {
                if (message is not null)
                {
                    session.PushClipboard(message);
                }
            });
            logger.LogInformation("Clipboard sync enabled for {DeviceName}.", session.DeviceName);
            clipboardReadNotifier?.NotifySyncEnabled(session.DeviceName);
        }

        return RemoteActionResponse.Ok();
    }

    // Das Geraet schaltet die Anzeige nur ein, solange sie sichtbar ist - ohne Zuhoerer misst der
    // PC gar nichts.
    private RemoteActionResponse HandleSystemStats(RemoteActionRequest request, RemoteActionSession? session)
    {
        if (systemStats is null || session is null)
        {
            return Fail("System stats are not supported.");
        }

        if (request.Enabled is not { } enabled)
        {
            return Fail("Action 'systemStats' requires enabled.");
        }

        if (!enabled)
        {
            session.SystemStatsSubscription?.Dispose();
            session.SystemStatsSubscription = null;
        }
        else
        {
            session.SystemStatsSubscription ??= systemStats.Subscribe(session.PushSystemStats);
        }

        return RemoteActionResponse.Ok();
    }

    // Wie die Systemanzeige: Voicemeeter wird nur gelesen, solange ein Geraet den Mixer offen hat.
    private RemoteActionResponse HandleVoicemeeterWatch(RemoteActionRequest request, RemoteActionSession? session)
    {
        if (voicemeeterStatus is null || session is null)
        {
            return Fail("Voicemeeter is not supported.");
        }

        if (request.Enabled is not { } enabled)
        {
            return Fail("Action 'voicemeeter' requires enabled.");
        }

        if (!enabled)
        {
            session.VoicemeeterSubscription?.Dispose();
            session.VoicemeeterSubscription = null;
        }
        else
        {
            session.VoicemeeterSubscription ??= voicemeeterStatus.Subscribe(session.PushVoicemeeter);
        }

        return RemoteActionResponse.Ok();
    }

    // Nur Stummschaltung, Lautstaerke und Routing - kein freies Voicemeeter-Skript, das z.B.
    // Konfigurationsdateien laden oder Voicemeeter beenden koennte. Ohne value wird umgeschaltet.
    private RemoteActionResponse HandleVoicemeeterParameter(RemoteActionRequest request)
    {
        if (voicemeeter is null)
        {
            return Fail("Voicemeeter is not supported.");
        }

        var parameter = request.Parameter?.Trim();
        if (parameter is null || !VoicemeeterParameterPattern().IsMatch(parameter))
        {
            return Fail($"Unsupported Voicemeeter parameter: {request.Parameter}");
        }

        var valid = parameter.EndsWith(".Gain", StringComparison.Ordinal)
            ? request.Value is >= IVoicemeeterService.MinGain and <= IVoicemeeterService.MaxGain
            : request.Value is null or 0 or 1;
        if (!valid)
        {
            return Fail("Voicemeeter gain takes -60 to 12 dB, switches take 0, 1 or no value to toggle.");
        }

        logger.LogDebug("Setting Voicemeeter {Parameter} to {Value}.", parameter, request.Value?.ToString() ?? "toggle");
        voicemeeter.SetParameter(parameter, (float?)request.Value);

        return RemoteActionResponse.Ok();
    }

    [GeneratedRegex(@"^(Strip\[[0-7]\]\.(Mute|Gain|A[1-5]|B[1-3])|Bus\[[0-7]\]\.(Mute|Gain))$")]
    private static partial Regex VoicemeeterParameterPattern();

    private RemoteActionResponse Fail(string error)
    {
        logger.LogWarning("Action rejected: {Error}", error);
        return RemoteActionResponse.Fail(error);
    }

    private static IReadOnlyList<string> NormalizeKeys(IReadOnlyList<string>? keys)
    {
        if (keys is null)
        {
            return [];
        }

        var normalizedKeys = new List<string>(keys.Count);
        foreach (var key in keys)
        {
            if (string.IsNullOrWhiteSpace(key))
            {
                continue;
            }

            normalizedKeys.Add(key.Trim().ToUpperInvariant());
        }

        return normalizedKeys;
    }

    private static bool IsInRange(int value, int min, int max) => value >= min && value <= max;
}
