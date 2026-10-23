using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Zustand einer einzelnen WebSocket-Verbindung. Jede Verbindung bekommt ihren eigenen virtuellen
// Controller, damit mehrere Geraete als mehrere Spieler erscheinen; mit der Verbindung wird er
// wieder abgesteckt. Ebenso enden mit ihr Zwischenablage-Abgleich, Systemanzeige und Mixer des Geraets.
public sealed class RemoteActionSession(
    Action<GamepadRumble>? onRumble = null,
    Action<ClipboardMessage>? onClipboard = null,
    Action<SystemStatsMessage>? onSystemStats = null,
    Action<VoicemeeterMessage>? onVoicemeeter = null,
    Action<AppVolumesMessage>? onApps = null) : IDisposable
{
    public string DeviceName { get; init; } = "Unbekanntes Gerät";

    internal IVirtualGamepad? Gamepad { get; set; }

    internal IDisposable? ClipboardSubscription { get; set; }

    internal IDisposable? SystemStatsSubscription { get; set; }

    internal IDisposable? VoicemeeterSubscription { get; set; }

    internal IDisposable? AppsSubscription { get; set; }

    internal void Rumble(GamepadRumble rumble) => onRumble?.Invoke(rumble);

    internal void PushClipboard(ClipboardMessage message) => onClipboard?.Invoke(message);

    internal void PushSystemStats(SystemStatsMessage message) => onSystemStats?.Invoke(message);

    internal void PushVoicemeeter(VoicemeeterMessage message) => onVoicemeeter?.Invoke(message);

    internal void PushApps(AppVolumesMessage message) => onApps?.Invoke(message);

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
        SystemStatsSubscription?.Dispose();
        SystemStatsSubscription = null;
        VoicemeeterSubscription?.Dispose();
        VoicemeeterSubscription = null;
        AppsSubscription?.Dispose();
        AppsSubscription = null;
    }
}
