namespace YFRemote.Server.Services;

// Fragt eine Quelle (Zwischenablage, Medienstatus) im festen Takt ab, solange mindestens eine
// Verbindung zuhoert, und meldet nur Aenderungen. Ohne Zuhoerer laeuft kein Timer - die
// Zwischenablage wird dann gar nicht gelesen.
// ponytail: Abfrage im Sekundentakt statt Systemereignissen; reicht fuer Anzeige und Abgleich,
// Ereignisse (AddClipboardFormatListener, GSMTC-Events) erst, wenn die Verzoegerung stoert.
public sealed class PollingBroadcaster<T>(
    Func<Task<T>> poll,
    TimeSpan interval,
    bool announceCurrent,
    ILogger logger)
{
    private readonly object syncRoot = new();
    private readonly List<Action<T>> subscribers = [];
    private System.Threading.Timer? timer;
    private bool hasValue;
    private T? lastValue;
    private int polling;

    // announceCurrent: ein neuer Zuhoerer bekommt sofort den letzten Stand (Medienstatus). Ohne
    // nur echte Aenderungen ab jetzt (Zwischenablage - kein Abgleich alter Inhalte beim Einschalten).
    public IDisposable Subscribe(Action<T> onChanged)
    {
        lock (syncRoot)
        {
            subscribers.Add(onChanged);

            if (subscribers.Count == 1)
            {
                // Timeout.InfiniteTimeSpan: kein Timer, Tests rufen PollAsync selbst auf.
                timer = interval == Timeout.InfiniteTimeSpan
                    ? null
                    : new System.Threading.Timer(_ => _ = PollAsync(), null, TimeSpan.Zero, interval);
            }
            else if (announceCurrent && hasValue)
            {
                onChanged(lastValue!);
            }
        }

        return new Subscription(this, onChanged);
    }

    internal async Task PollAsync()
    {
        if (Interlocked.Exchange(ref polling, 1) == 1)
        {
            return;
        }

        try
        {
            T value;
            try
            {
                value = await poll();
            }
            catch (Exception exception)
            {
                logger.LogDebug(exception, "Polling {Source} failed.", typeof(T).Name);
                return;
            }

            Action<T>[] targets;
            lock (syncRoot)
            {
                if (subscribers.Count == 0
                    || (hasValue && EqualityComparer<T>.Default.Equals(lastValue, value)))
                {
                    return;
                }

                var announce = hasValue || announceCurrent;
                hasValue = true;
                lastValue = value;

                if (!announce)
                {
                    return;
                }

                targets = [.. subscribers];
            }

            foreach (var target in targets)
            {
                target(value);
            }
        }
        finally
        {
            Volatile.Write(ref polling, 0);
        }
    }

    private void Unsubscribe(Action<T> onChanged)
    {
        lock (syncRoot)
        {
            if (!subscribers.Remove(onChanged) || subscribers.Count > 0)
            {
                return;
            }

            timer?.Dispose();
            timer = null;
            hasValue = false;
            lastValue = default;
        }
    }

    private sealed class Subscription(PollingBroadcaster<T> owner, Action<T> onChanged) : IDisposable
    {
        private int disposed;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref disposed, 1) == 0)
            {
                owner.Unsubscribe(onChanged);
            }
        }
    }
}
