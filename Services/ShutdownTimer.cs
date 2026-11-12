using YFRemote.Server.Models;
using Timer = System.Threading.Timer;

namespace YFRemote.Server.Services;

// Was der Zeitgeber bei Ablauf tut; Name im Protokoll wie die gleichnamigen Aktionen.
public enum TimerAction
{
    Shutdown,
    Sleep,
    DisplayOff,
}

// Eigener Zeitgeber statt "shutdown.exe /t": unter Windows schliesst jedes /t > 0 die Apps wie /f
// ohne Rueckfrage, ungespeicherte Arbeit waere weg. So laeuft bei Ablauf dasselbe Herunterfahren
// (oder Ruhemodus, Bildschirm aus) wie ueber den Button. Der Zeitgeber lebt nur in diesem Prozess -
// wird YFRemote beendet, entfaellt er. Es gibt immer hoechstens einen Termin.
public sealed class ShutdownTimer(IPowerService powerService, ILogger<ShutdownTimer> logger) : IDisposable
{
    private readonly Lock gate = new();
    private Timer? timer;

    public DateTimeOffset? DueAt { get; private set; }

    // Bleibt nach Abbruch oder Ablauf stehen, damit der Tray noch sagen kann, was abgebrochen wurde.
    public TimerAction Action { get; private set; }

    public ShutdownTimerMessage Status =>
        DueAt is { } dueAt
            ? new((int)Math.Ceiling(Math.Max(0, (dueAt - DateTimeOffset.Now).TotalSeconds)), ProtocolName(Action))
            : new(null);

    public static string ProtocolName(TimerAction action) => action switch
    {
        TimerAction.Sleep => "sleep",
        TimerAction.DisplayOff => "displayOff",
        _ => "shutdown",
    };

    // Geplant oder abgebrochen; deviceName ist null, wenn der Tray selbst abbricht. Kommt vom
    // Thread der Verbindung bzw. des Tray.
    public event Action<string?>? Changed;

    public void Schedule(TimeSpan delay, string deviceName, TimerAction action = TimerAction.Shutdown)
    {
        var dueAt = DateTimeOffset.Now + delay;
        lock (gate)
        {
            timer?.Dispose();
            DueAt = dueAt;
            Action = action;
            timer = new Timer(_ => Elapse(dueAt), null, delay, Timeout.InfiniteTimeSpan);
        }

        logger.LogInformation("{Action} scheduled for {DueAt} by {DeviceName}.", action, dueAt, deviceName);
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

        logger.LogInformation("Scheduled {Action} cancelled by {DeviceName}.", Action, deviceName ?? "tray");
        Changed?.Invoke(deviceName);
    }

    private void Elapse(DateTimeOffset dueAt)
    {
        TimerAction action;
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
            action = Action;
        }

        // Schlaegt das Herunterfahren fehl, zeigten Tray und Geraete sonst weiter den alten Termin.
        Changed?.Invoke(null);

        try
        {
            logger.LogInformation("Executing scheduled {Action}.", action);
            switch (action)
            {
                case TimerAction.Sleep:
                    powerService.Sleep();
                    break;
                case TimerAction.DisplayOff:
                    powerService.TurnOffDisplay();
                    break;
                default:
                    powerService.Shutdown();
                    break;
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Scheduled {Action} failed.", action);
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
