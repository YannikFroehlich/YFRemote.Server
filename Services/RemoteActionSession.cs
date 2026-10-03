using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Zustand einer einzelnen WebSocket-Verbindung. Jede Verbindung bekommt ihren eigenen virtuellen
// Controller, damit mehrere Geraete als mehrere Spieler erscheinen; mit der Verbindung wird er
// wieder abgesteckt. Ebenso endet mit ihr der Zwischenablage-Abgleich des Geraets.
public sealed class RemoteActionSession(
    Action<GamepadRumble>? onRumble = null,
    Action<ClipboardMessage>? onClipboard = null) : IDisposable
{
    public string DeviceName { get; init; } = "Unbekanntes Gerät";

    internal IVirtualGamepad? Gamepad { get; set; }

    internal IDisposable? ClipboardSubscription { get; set; }

    internal void Rumble(GamepadRumble rumble) => onRumble?.Invoke(rumble);

    internal void PushClipboard(ClipboardMessage message) => onClipboard?.Invoke(message);

    internal void DisconnectGamepad()
    {
        Gamepad?.Dispose();
        Gamepad = null;
    }

    public void Dispose()
    {
        DisconnectGamepad();
        ClipboardSubscription?.Dispose();
        ClipboardSubscription = null;
    }
}
