using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

public sealed class RemoteActionHandler(
    IInputService inputService,
    IMouseService mouseService,
    ILogger<RemoteActionHandler> logger)
{
    private const int MinMouseMoveDelta = -5000;
    private const int MaxMouseMoveDelta = 5000;
    private const int MinMouseScrollDelta = -1200;
    private const int MaxMouseScrollDelta = 1200;
    private const int MaxTextLength = 500;

    public RemoteActionResponse Handle(RemoteActionRequest? request)
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
                "mousescroll" => HandleMouseScroll(request),
                null or "" => Fail("Missing action type."),
                _ => Fail($"Unsupported action type: {request.Type}")
            };
        }
        catch (UnsupportedKeyException ex)
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

            default:
                return Fail($"Unsupported mouse button: {request.Button}");
        }
    }

    private RemoteActionResponse HandleMouseScroll(RemoteActionRequest request)
    {
        if (request.Delta is null)
        {
            return Fail("Action 'mouseScroll' requires delta.");
        }

        if (!IsInRange(request.Delta.Value, MinMouseScrollDelta, MaxMouseScrollDelta))
        {
            return Fail($"delta must be between {MinMouseScrollDelta} and {MaxMouseScrollDelta}.");
        }

        logger.LogTrace("Executing mouseScroll action: delta={Delta}", request.Delta.Value);
        mouseService.Scroll(request.Delta.Value);

        return RemoteActionResponse.Ok();
    }

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
