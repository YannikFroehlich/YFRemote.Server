namespace YFRemote.Server.Services;

// Ein gekoppeltes Geraet kann die PC-Zwischenablage (ggf. mit Passwoertern) auslesen - der Tray
// zeigt das jedes Mal an, damit ein unerwarteter Zugriff am PC auffaellt.
public sealed class ClipboardReadNotifier
{
    public event Action<string>? TextRead;

    public void NotifyTextRead(string deviceName) => TextRead?.Invoke(deviceName);
}
