using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Zustand einer einzelnen WebSocket-Verbindung. Jede Verbindung bekommt ihren eigenen virtuellen
// Controller, damit mehrere Geraete als mehrere Spieler erscheinen; mit der Verbindung wird er
// wieder abgesteckt.
public sealed class RemoteActionSession(Action<GamepadRumble>? onRumble = null) : IDisposable
{
    internal IVirtualGamepad? Gamepad { get; set; }

    internal void Rumble(GamepadRumble rumble) => onRumble?.Invoke(rumble);

    public void Dispose()
    {
        Gamepad?.Dispose();
        Gamepad = null;
    }
}
