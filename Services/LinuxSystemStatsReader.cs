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

    private readonly Lazy<string?> cpuTemperaturePath = new(() => FindHwmonInput(CpuSensorNames));
    private readonly Lazy<string?> gpuTemperaturePath = new(() => FindHwmonInput(GpuSensorNames));
    private readonly Lazy<string?> gpuBusyPath = new(() => Directory.Exists("/sys/class/drm")
        ? Directory.EnumerateDirectories("/sys/class/drm", "card*")
            .Select(card => Path.Combine(card, "device", "gpu_busy_percent"))
            .FirstOrDefault(File.Exists)
        : null);

    private long previousIdle;
    private long previousTotal;

    public async Task<SystemStatsMessage> ReadAsync()
    {
        var (idle, total) = ParseCpuTimes(await File.ReadAllTextAsync("/proc/stat"));
        int? cpuLoad = previousTotal == 0 || total == previousTotal
            ? null
            : Math.Clamp((int)Math.Round(100.0 * (1 - (double)(idle - previousIdle) / (total - previousTotal))), 0, 100);
        previousIdle = idle;
        previousTotal = total;

        var (usedMb, totalMb) = ParseMemInfo(await File.ReadAllTextAsync("/proc/meminfo"));

        return new SystemStatsMessage(
            cpuLoad,
            ReadMilliCelsius(cpuTemperaturePath.Value),
            ReadInt(gpuBusyPath.Value),
            ReadMilliCelsius(gpuTemperaturePath.Value),
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

    private static string? FindHwmonInput(string[] sensorNames)
    {
        if (!Directory.Exists("/sys/class/hwmon"))
        {
            return null;
        }

        return Directory.EnumerateDirectories("/sys/class/hwmon")
            .Where(directory => File.Exists(Path.Combine(directory, "temp1_input"))
                && sensorNames.Contains(TryRead(Path.Combine(directory, "name"))?.Trim()))
            .Select(directory => Path.Combine(directory, "temp1_input"))
            .FirstOrDefault();
    }

    private static int? ReadMilliCelsius(string? path) =>
        ReadInt(path) is { } milli ? (int)Math.Round(milli / 1000.0) : null;

    private static int? ReadInt(string? path) =>
        path is not null && int.TryParse(TryRead(path), CultureInfo.InvariantCulture, out var value)
            ? value
            : null;

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
