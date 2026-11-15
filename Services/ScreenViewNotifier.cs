using System.Collections.Concurrent;

namespace YFRemote.Server.Services;

// Wer den Bildschirm ansieht, sieht alles, was am PC offen ist - der Tray meldet das, damit es am
// PC auffaellt. Nicht bei jedem Bild (mehrere pro Sekunde), sondern wenn ein Geraet nach einer
// Pause wieder anfaengt.
public sealed class ScreenViewNotifier(TimeProvider timeProvider)
{
    private static readonly TimeSpan Pause = TimeSpan.FromMinutes(1);
    private readonly ConcurrentDictionary<Guid, DateTimeOffset> lastFrames = new();

    private readonly ConcurrentDictionary<Guid, DateTimeOffset> lastAudio = new();

    public event Action<string>? Started;

    public event Action<string>? AudioStarted;

    // Der PC-Ton allein (ein Anruf, ein Video) ist genauso mithoeren. Laeuft schon das Bild
    // desselben Geraets, ist die Meldung dazu bereits da.
    public void NotifyAudio(Guid deviceId, Func<string> deviceName)
    {
        var now = timeProvider.GetUtcNow();
        var previous = lastAudio.GetValueOrDefault(deviceId, DateTimeOffset.MinValue);
        lastAudio[deviceId] = now;
        if (now - previous > Pause && now - lastFrames.GetValueOrDefault(deviceId, DateTimeOffset.MinValue) > Pause)
        {
            AudioStarted?.Invoke(deviceName());
        }
    }

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
