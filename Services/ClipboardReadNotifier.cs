using System.Collections.Concurrent;

namespace YFRemote.Server.Services;

// Ein gekoppeltes Geraet kann die PC-Zwischenablage (ggf. mit Passwoertern) auslesen - der Tray
// zeigt das jedes Mal an, damit ein unerwarteter Zugriff am PC auffaellt. Beim automatischen
// Abgleich nur einmal pro Geraet und Programmlauf: das Geraet schaltet ihn bei jedem
// Wiederverbinden erneut ein, und jede kopierte Zeile als Sprechblase waere zu viel.
public sealed class ClipboardReadNotifier
{
    private readonly ConcurrentDictionary<string, bool> syncAnnounced = new();

    public event Action<string>? TextRead;

    public event Action<string>? SyncEnabled;

    public void NotifyTextRead(string deviceName) => TextRead?.Invoke(deviceName);

    public void NotifySyncEnabled(string deviceName)
    {
        if (syncAnnounced.TryAdd(deviceName, true))
        {
            SyncEnabled?.Invoke(deviceName);
        }
    }
}
