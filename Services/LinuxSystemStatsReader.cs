using System.Globalization;
using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// CPU und Arbeitsspeicher aus /proc, Temperaturen aus hwmon (coretemp/k10temp fuer die CPU,
// amdgpu/nouveau fuer die GPU), GPU-Auslastung aus gpu_busy_percent (nur amdgpu). Nur Dateien
// lesen, keine Prozessstarts - abgefragt wird ohnehin nur, solange ein Geraet zusieht.
// ponytail: keine NVIDIA-Werte (proprietaerer Treiber hat kein sysfs) - NVML oder nvidia-smi
// erst, wenn das jemand unter Linux braucht.
public sealed class LinuxSystemStatsReader
{
    private static readonly string[] CpuSensorNames = ["coretemp", "k10temp", "zenpower", "cpu_thermal"];
    private static readonly string[] GpuSensorNames = ["amdgpu", "nouveau", "radeon"];

    // Nach einer laengeren Pause (niemand hatte die Anzeige offen) waere der Vergleichswert alt und
    // die erste CPU-Last das Mittel ueber die ganze Pause - dann wie beim ersten Lesen null.
    private static readonly TimeSpan ResumeAfter = TimeSpan.FromSeconds(5);

    private long previousIdle;
    private long previousTotal;
    private DateTime lastReadUtc;

    public async Task<SystemStatsMessage> ReadAsync()
    {
        var now = DateTime.UtcNow;
        if (now - lastReadUtc > ResumeAfter)
        {
            previousTotal = 0;
        }

        lastReadUtc = now;

        var (idle, total) = ParseCpuTimes(await File.ReadAllTextAsync("/proc/stat"));
        int? cpuLoad = previousTotal == 0 || total == previousTotal
            ? null
            : Math.Clamp((int)Math.Round(100.0 * (1 - (double)(idle - previousIdle) / (total - previousTotal))), 0, 100);
        previousIdle = idle;
        previousTotal = total;

        var (usedMb, totalMb) = ParseMemInfo(await File.ReadAllTextAsync("/proc/meminfo"));

        return new SystemStatsMessage(
            cpuLoad,
            HottestSensor(CpuSensorNames),
            BusiestGpu(),
            HottestSensor(GpuSensorNames),
            usedMb,
            totalMb);
    }

    // Erste Zeile: "cpu  user nice system idle iowait irq softirq steal guest guest_nice". Guest
    // steckt schon in user/nice und zaehlt deshalb nicht noch einmal.
    internal static (long Idle, long Total) ParseCpuTimes(string stat)
    {
        var fields = stat.Split('\n')[0]
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Skip(1)
            .Take(8)
            .Select(field => long.Parse(field, CultureInfo.InvariantCulture))
            .ToArray();
        return (fields[3] + fields[4], fields.Sum());
    }

    // MemAvailable statt MemFree: Cache, den der Kernel bei Bedarf freigibt, gilt nicht als belegt.
    internal static (long UsedMb, long TotalMb) ParseMemInfo(string meminfo)
    {
        long ReadKb(string key) => meminfo.Split('\n')
            .Where(line => line.StartsWith(key + ":", StringComparison.Ordinal))
            .Select(line => long.Parse(
                line[(key.Length + 1)..].Trim().Split(' ')[0],
                CultureInfo.InvariantCulture))
            .FirstOrDefault();

        var totalKb = ReadKb("MemTotal");
        return ((totalKb - ReadKb("MemAvailable")) / 1024, totalKb / 1024);
    }

    // Wie unter Windows ein Wert fuer alle Grafikkarten (bzw. CPU-Sockel) zusammen: die heisseste
    // und die vollste zaehlen - unabhaengig von der Reihenfolge der Verzeichnisse. Jedes Mal neu
    // gesucht, sonst fiele ein spaet geladener Treiber oder ein neu nummeriertes hwmon-Verzeichnis
    // bis zum Neustart aus; das sind nur ein paar sysfs-Dateien.
    private static int? HottestSensor(string[] sensorNames) =>
        Directory.Exists("/sys/class/hwmon")
            ? Directory.EnumerateDirectories("/sys/class/hwmon")
                .Where(directory => sensorNames.Contains(TryRead(Path.Combine(directory, "name"))?.Trim()))
                .Select(directory => ReadInt(Path.Combine(directory, "temp1_input")) is { } milli
                    ? (int?)Math.Round(milli / 1000.0)
                    : null)
                .Max()
            : null;

    private static int? BusiestGpu() =>
        Directory.Exists("/sys/class/drm")
            ? Directory.EnumerateDirectories("/sys/class/drm", "card*")
                .Select(card => ReadInt(Path.Combine(card, "device", "gpu_busy_percent")))
                .Max()
            : null;

    private static int? ReadInt(string path) =>
        int.TryParse(TryRead(path), CultureInfo.InvariantCulture, out var value) ? value : null;

    private static string? TryRead(string path)
    {
        try
        {
            return File.ReadAllText(path);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }
}
