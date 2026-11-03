using System.Collections.Concurrent;

namespace YFRemote.Server.Services;

// Wer den Bildschirm ansieht, sieht alles, was am PC offen ist - der Tray meldet das, damit es am
// PC auffaellt. Nicht bei jedem Bild (mehrere pro Sekunde), sondern wenn ein Geraet nach einer
// Pause wieder anfaengt.
public sealed class ScreenViewNotifier(TimeProvider timeProvider)
{
    private static readonly TimeSpan Pause = TimeSpan.FromMinutes(1);
    private readonly ConcurrentDictionary<Guid, DateTimeOffset> lastFrames = new();

    public event Action<string>? Started;

    public void NotifyFrame(Guid deviceId, Func<string> deviceName)
    {
        var now = timeProvider.GetUtcNow();
        var previous = lastFrames.GetValueOrDefault(deviceId, DateTimeOffset.MinValue);
        lastFrames[deviceId] = now;
        if (now - previous > Pause)
        {
            Started?.Invoke(deviceName());
        }
    }
}
