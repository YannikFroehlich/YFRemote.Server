namespace YFRemote.Server.Services;

// Passt die Encoder-Bitrate an die Verbindung an. Haengt das Senden mehr als ein Viertel der Zeit,
// kommt sie nicht nach: was dabei durchging, ist ihre Kapazitaet, darunter geht die Bitrate sofort.
// Bei der halben Zeit als Schwelle blieben gemessen 700 ms Stau sekundenlang unerkannt.
// Nach oben tastet sie sich langsam zurueck, aber nur wenn der Strom die Bitrate auch nutzt - ein
// ruhiger Bildschirm sagt nichts ueber die Verbindung.
// ponytail: festes Tasten, an einer knappen Leitung gemessen alle gut 20 s rund 4 s Stau bis 1 s.
// Wird das stoerend, die Wartezeit nach jedem Abfall verdoppeln.
public sealed class VideoBitrateControl(int maxKbps)
{
    private const int MinKbps = 1000;
    private static readonly TimeSpan Window = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan HoldAfterDrop = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan RaiseInterval = TimeSpan.FromSeconds(2);

    private readonly int maxKbps = maxKbps;
    private int kbps = maxKbps;
    private TimeSpan windowStart;
    private TimeSpan windowBlocked;
    private TimeSpan nextRaise;
    private long windowBytes;

    public int Kbps => Volatile.Read(ref kbps);

    public void Report(int bytes, TimeSpan blocked, TimeSpan now)
    {
        windowBytes += bytes;
        windowBlocked += blocked;
        var elapsed = now - windowStart;
        if (elapsed < Window)
        {
            return;
        }

        var current = kbps;
        var throughputKbps = windowBytes * 8 / elapsed.TotalMilliseconds;
        if (windowBlocked >= elapsed / 4)
        {
            // Hoechstens halbieren: ein kurzer WLAN-Aussetzer laesst fast nichts durch und sagt
            // wenig ueber die Kapazitaet.
            var lowered = Math.Max(current * 0.5, Math.Min(current * 0.85, throughputKbps * 0.8));
            Volatile.Write(ref kbps, Math.Max(MinKbps, (int)lowered));
            nextRaise = now + HoldAfterDrop;
        }
        else if (current < maxKbps && now >= nextRaise && throughputKbps >= current * 0.3)
        {
            Volatile.Write(ref kbps, Math.Min(maxKbps, (int)(current * 1.2)));
            nextRaise = now + RaiseInterval;
        }

        windowStart = now;
        windowBlocked = TimeSpan.Zero;
        windowBytes = 0;
    }
}
