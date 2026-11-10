using System.Collections.Concurrent;

namespace YFRemote.Server.Services;

// Ein gekoppeltes Geraet kann die PC-Zwischenablage (ggf. mit Passwoertern) auslesen - der Tray
// zeigt das jedes Mal an, damit ein unerwarteter Zugriff am PC auffaellt. Beim automatischen
// Abgleich nur einmal pro Geraet und Programmlauf: das Geraet schaltet ihn bei jedem
// Wiederverbinden erneut ein, und jede kopierte Zeile als Sprechblase waere zu viel.
// Ebenso einmal, wenn ein Geraet die Windows-Benachrichtigungen weitergeleitet bekommt.
public sealed class ClipboardReadNotifier
{
    private readonly ConcurrentDictionary<string, bool> syncAnnounced = new();
    private readonly ConcurrentDictionary<string, bool> notificationsAnnounced = new();

    public event Action<string>? Read;

    public event Action<string>? SyncEnabled;

    public event Action<string>? NotificationsEnabled;

    public void NotifyRead(string deviceName) => Read?.Invoke(deviceName);

    public void NotifySyncEnabled(string deviceName)
    {
        if (syncAnnounced.TryAdd(deviceName, true))
        {
            SyncEnabled?.Invoke(deviceName);
        }
    }

    public void NotifyNotificationsEnabled(string deviceName)
    {
        if (notificationsAnnounced.TryAdd(deviceName, true))
        {
            NotificationsEnabled?.Invoke(deviceName);
        }
    }
}
