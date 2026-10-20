using YFRemote.Server.Models;
using Timer = System.Threading.Timer;

namespace YFRemote.Server.Services;

// Eigener Zeitgeber statt "shutdown.exe /t": unter Windows schliesst jedes /t > 0 die Apps wie /f
// ohne Rueckfrage, ungespeicherte Arbeit waere weg. So laeuft bei Ablauf dasselbe Herunterfahren
// wie ueber den Button. Der Zeitgeber lebt nur in diesem Prozess - wird YFRemote beendet, entfaellt er.
public sealed class ShutdownTimer(IPowerService powerService, ILogger<ShutdownTimer> logger) : IDisposable
{
    private readonly Lock gate = new();
    private Timer? timer;

    public DateTimeOffset? DueAt { get; private set; }

    public ShutdownTimerMessage Status =>
        new(DueAt is { } dueAt ? (int)Math.Ceiling(Math.Max(0, (dueAt - DateTimeOffset.Now).TotalSeconds)) : null);

    // Geplant oder abgebrochen; deviceName ist null, wenn der Tray selbst abbricht. Kommt vom
    // Thread der Verbindung bzw. des Tray.
    public event Action<string?>? Changed;

    public void Schedule(TimeSpan delay, string deviceName)
    {
        var dueAt = DateTimeOffset.Now + delay;
        lock (gate)
        {
            timer?.Dispose();
            DueAt = dueAt;
            timer = new Timer(_ => Elapse(dueAt), null, delay, Timeout.InfiniteTimeSpan);
        }

        logger.LogInformation("Shutdown scheduled for {DueAt} by {DeviceName}.", dueAt, deviceName);
        Changed?.Invoke(deviceName);
    }

    public void Cancel(string? deviceName)
    {
        lock (gate)
        {
            if (timer is null)
            {
                return;
            }

            timer.Dispose();
            timer = null;
            DueAt = null;
        }

        logger.LogInformation("Scheduled shutdown cancelled by {DeviceName}.", deviceName ?? "tray");
        Changed?.Invoke(deviceName);
    }

    private void Elapse(DateTimeOffset dueAt)
    {
        lock (gate)
        {
            // Ein inzwischen ersetzter oder abgebrochener Zeitgeber kann noch feuern.
            if (DueAt != dueAt)
            {
                return;
            }

            timer?.Dispose();
            timer = null;
            DueAt = null;
        }

        // Schlaegt das Herunterfahren fehl, zeigten Tray und Geraete sonst weiter den alten Termin.
        Changed?.Invoke(null);

        try
        {
            logger.LogInformation("Executing scheduled shutdown.");
            powerService.Shutdown();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Scheduled shutdown failed.");
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            timer?.Dispose();
            timer = null;
        }
    }
}
