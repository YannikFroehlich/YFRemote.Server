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

    // Im Tray auf "Nur Medien" gestellt; gilt fuer die ganze Verbindung, das Umstellen trennt sie.
    public bool MediaOnly { get; init; }

    // Noch gedrueckte Maustasten samt ihrem Loslassen: reisst die Verbindung mitten im Ziehen ab,
    // kommt kein mouseUp mehr, und die Taste bliebe am PC gedrueckt.
    private readonly Dictionary<string, Action> heldMouseButtons = [];

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

    internal void HoldMouseButton(string button, Action release) => heldMouseButtons[button] = release;

    internal void ReleaseMouseButton(string button) => heldMouseButtons.Remove(button);

    internal void DisconnectGamepad()
    {
        Gamepad?.Dispose();
        Gamepad = null;
    }

    public void Dispose()
    {
        foreach (var release in heldMouseButtons.Values)
        {
            try
            {
                release();
            }
            catch (Exception exception) when (exception is InputBlockedException or System.ComponentModel.Win32Exception)
            {
                // Sicherer Desktop: mehr geht hier nicht, die Verbindung ist ohnehin weg.
            }
        }

        heldMouseButtons.Clear();
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
