using System.Diagnostics;
using System.Net.NetworkInformation;
using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Laufwerke und Netzwerkdurchsatz fuer die Systemanzeige. Nur BCL, deshalb haengt es sich an die
// Messwerte beider Plattformen (Wrap), statt in jedem der beiden Leser zu stehen.
public sealed class SystemExtrasReader
{
    private const int MaxDrives = 8;
    private const long MinDriveBytes = 1024L * 1024 * 1024;
    private const long BytesPerMb = 1024 * 1024;

    // Wie in den Lesern: Nach einer Pause waere der Vergleichswert alt und die erste Rate das Mittel
    // ueber die ganze Pause.
    private static readonly TimeSpan ResumeAfter = TimeSpan.FromSeconds(5);

    private long previousReceived;
    private long previousSent;
    private long previousTimestamp;

    public Func<Task<SystemStatsMessage>> Wrap(Func<Task<SystemStatsMessage>> read) =>
        async () =>
        {
            var stats = await read();
            var (down, up) = ReadNetwork();
            return stats with { Drives = ReadDrives(), NetDownKbps = down, NetUpKbps = up };
        };

    // ponytail: nur fest eingebaute Laufwerke ab 1 GB - unter Linux blendet das tmpfs, Snap-Abbilder
    // und die EFI-Partition aus, aber auch Netzlaufwerke und USB-Sticks. Nachziehen, wenn die fehlen.
    private static List<DriveStats> ReadDrives()
    {
        var drives = new List<DriveStats>();
        foreach (var drive in DriveInfo.GetDrives())
        {
            try
            {
                if (drive.DriveType == DriveType.Fixed && drive.IsReady && drive.TotalSize >= MinDriveBytes)
                {
                    drives.Add(new DriveStats(
                        drive.Name.TrimEnd('\\'),
                        drive.AvailableFreeSpace / BytesPerMb,
                        drive.TotalSize / BytesPerMb));
                }
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                // Laufwerk gerade ausgeworfen oder gesperrt.
            }
        }

        return drives.Take(MaxDrives).ToList();
    }

    // ponytail: Summe ueber alle aktiven Adapter. Virtuelle Adapter (Hyper-V, VPN) koennen denselben
    // Verkehr doppelt zaehlen - dann auf den Adapter mit Standardgateway beschraenken.
    private (int? Down, int? Up) ReadNetwork()
    {
        long received = 0;
        long sent = 0;
        foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (adapter.OperationalStatus != OperationalStatus.Up
                || adapter.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel)
            {
                continue;
            }

            try
            {
                var statistics = adapter.GetIPStatistics();
                received += statistics.BytesReceived;
                sent += statistics.BytesSent;
            }
            catch (NetworkInformationException)
            {
            }
        }

        var now = Stopwatch.GetTimestamp();
        var elapsed = Stopwatch.GetElapsedTime(previousTimestamp, now);
        var first = previousTimestamp == 0 || elapsed > ResumeAfter;
        var rates = first
            ? default((int?, int?))
            : (Kbps(received - previousReceived, elapsed), Kbps(sent - previousSent, elapsed));
        previousReceived = received;
        previousSent = sent;
        previousTimestamp = now;
        return rates;
    }

    // Kilobit pro Sekunde; ein zurueckgesetzter Zaehler (Adapter neu verbunden) zaehlt als 0.
    internal static int Kbps(long bytes, TimeSpan elapsed) =>
        bytes <= 0 || elapsed <= TimeSpan.Zero
            ? 0
            : (int)Math.Min(int.MaxValue, Math.Round(bytes * 8 / 1000.0 / elapsed.TotalSeconds));
}
