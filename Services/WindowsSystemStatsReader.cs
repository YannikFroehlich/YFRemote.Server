using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// CPU ueber GetSystemTimes, Arbeitsspeicher ueber GlobalMemoryStatusEx, GPU-Auslastung ueber die
// Leistungsindikatoren "GPU Engine" (dieselbe Quelle wie der Task-Manager) und GPU-Temperatur ueber
// D3DKMT - alles ohne Adminrechte und ohne Treiber. Eine CPU-Temperatur gibt Windows ohne
// Kerneltreiber nicht heraus; die kommt nur, wenn LibreHardwareMonitor mit eingeschaltetem
// Webserver laeuft (siehe RefreshSensorToolTemperaturesAsync), sonst bleibt sie null.
// Abgefragt wird nur, solange ein Geraet die Systemanzeige offen hat (PollingBroadcaster).
// fetchSensorTool ersetzen nur Tests, damit sie nicht vom echten Port 8085 abhaengen.
public sealed partial class WindowsSystemStatsReader(Func<Task<string>>? fetchSensorTool = null) : IDisposable
{
    private const uint PdhFormatDouble = 0x00000200;
    private const int PdhMoreData = unchecked((int)0x800007D2);
    private const int KmtQueryAdapterPerfData = 62;
    private static readonly TimeSpan SensorToolRetryDelay = TimeSpan.FromSeconds(30);

    // Nach einer laengeren Pause (niemand hatte die Anzeige offen) waeren die Vergleichswerte alt:
    // Die erste CPU- und GPU-Last zeigte das Mittel ueber die ganze Pause, die Temperaturen den
    // Stand von damals.
    private static readonly TimeSpan ResumeAfter = TimeSpan.FromSeconds(5);

    // ponytail: fester Standardport von LibreHardwareMonitor ("Remote Web Server"); einstellbar
    // erst, wenn jemand ihn dort aendert.
    private static readonly HttpClient SensorToolClient = new()
    {
        BaseAddress = new Uri("http://localhost:8085/"),
        Timeout = TimeSpan.FromSeconds(2)
    };

    private readonly Func<Task<string>> fetchSensorTool =
        fetchSensorTool ?? (() => SensorToolClient.GetStringAsync("data.json"));
    private readonly object syncRoot = new();
    private long previousIdle;
    private long previousTotal;
    private IntPtr gpuQuery;
    private IntPtr gpuCounter;
    private bool gpuCounterUnavailable;
    private DateTime lastReadUtc;
    private (int? Cpu, int? Gpu) sensorToolTemperatures;
    private int sensorToolRefreshing;
    private DateTime sensorToolRetryAtUtc;

    public Task<SystemStatsMessage> ReadAsync()
    {
        SystemStatsMessage stats;
        lock (syncRoot)
        {
            var now = DateTime.UtcNow;
            var resumed = now - lastReadUtc > ResumeAfter;
            lastReadUtc = now;
            if (resumed)
            {
                previousTotal = 0;
                sensorToolTemperatures = default;
            }

            var memory = new MemoryStatusEx { Length = (uint)Marshal.SizeOf<MemoryStatusEx>() };
            GlobalMemoryStatusEx(ref memory);
            const long bytesPerMb = 1024 * 1024;

            stats = new SystemStatsMessage(
                ReadCpuLoad(),
                sensorToolTemperatures.Cpu,
                ReadGpuLoad(resumed),
                ReadGpuTemperature() ?? sensorToolTemperatures.Gpu,
                (long)(memory.TotalPhys - memory.AvailPhys) / bytesPerMb,
                (long)memory.TotalPhys / bytesPerMb);
        }

        _ = RefreshSensorToolTemperaturesAsync();
        return Task.FromResult(stats);
    }

    public void Dispose()
    {
        lock (syncRoot)
        {
            if (gpuQuery != IntPtr.Zero)
            {
                PdhCloseQuery(gpuQuery);
                gpuQuery = IntPtr.Zero;
            }
        }
    }

    // LibreHardwareMonitor liest die Sensoren mit eigenem Treiber und Adminrechten; sein
    // "Remote Web Server" gibt sie als data.json heraus - YFRemote selbst braucht dafuer keine
    // Rechte. Die Antwort zaehlt erst ab der naechsten Messung: Laeuft er nicht, dauert eine
    // abgewiesene Verbindung unter Windows rund zwei Sekunden, so lange soll die Anzeige nicht
    // stehen. Danach erst nach einer Pause wieder fragen.
    private async Task RefreshSensorToolTemperaturesAsync()
    {
        if (DateTime.UtcNow < sensorToolRetryAtUtc || Interlocked.Exchange(ref sensorToolRefreshing, 1) == 1)
        {
            return;
        }

        try
        {
            var temperatures = ParseSensorToolTemperatures(await fetchSensorTool());
            lock (syncRoot)
            {
                sensorToolTemperatures = temperatures;
            }
        }
        catch
        {
            // Auch fremdes JSON auf dem Port (anderes Programm, andere LHM-Version) darf die
            // uebrigen Werte nicht mitreissen.
            lock (syncRoot)
            {
                sensorToolTemperatures = default;
            }

            sensorToolRetryAtUtc = DateTime.UtcNow + SensorToolRetryDelay;
        }
        finally
        {
            Volatile.Write(ref sensorToolRefreshing, 0);
        }
    }

    // data.json ist ein Baum; Sensoren tragen "SensorId" ("/intelcpu/0/temperature/6"), "Type"
    // und einen in der Sprache von LibreHardwareMonitor formatierten Wert ("55,0 °C"). Bevorzugt
    // der Wert, den das Programm selbst zuerst nennt; "Distance to TjMax" ist keine Temperatur.
    internal static (int? Cpu, int? Gpu) ParseSensorToolTemperatures(string json)
    {
        var sensors = new List<(string SensorId, string Name, double Value)>();
        void Collect(JsonElement node)
        {
            if (node.TryGetProperty("Type", out var type) && type.GetString() == "Temperature"
                && node.TryGetProperty("SensorId", out var sensorId)
                && node.TryGetProperty("Value", out var value)
                && LeadingNumber().Match(value.GetString() ?? string.Empty) is { Success: true } number
                && double.TryParse(number.Value.Replace(',', '.'), CultureInfo.InvariantCulture, out var celsius)
                && celsius > 0)
            {
                var name = node.TryGetProperty("Text", out var text) ? text.GetString() ?? string.Empty : string.Empty;
                if (!name.Contains("Distance", StringComparison.Ordinal))
                {
                    sensors.Add((sensorId.GetString() ?? string.Empty, name, celsius));
                }
            }

            if (node.TryGetProperty("Children", out var children) && children.ValueKind == JsonValueKind.Array)
            {
                foreach (var child in children.EnumerateArray())
                {
                    Collect(child);
                }
            }
        }

        using (var document = JsonDocument.Parse(json))
        {
            Collect(document.RootElement);
        }

        int? Pick(string[] hardware, string[] preferredNames)
        {
            var candidates = sensors
                .Where(sensor => hardware.Any(prefix => sensor.SensorId.StartsWith(prefix, StringComparison.Ordinal)))
                .ToList();
            if (candidates.Count == 0)
            {
                return null;
            }

            var celsius = candidates
                .Where(sensor => preferredNames.Contains(sensor.Name))
                .Select(sensor => (double?)sensor.Value)
                .FirstOrDefault() ?? candidates.Max(sensor => sensor.Value);
            return (int)Math.Round(celsius);
        }

        return (
            Pick(["/intelcpu/", "/amdcpu/"], ["CPU Package", "Core (Tctl/Tdie)", "Core (Tctl)"]),
            Pick(["/gpu-"], ["GPU Core"]));
    }

    [GeneratedRegex(@"^-?\d+([.,]\d+)?")]
    private static partial Regex LeadingNumber();

    // Die erste Abfrage hat keinen Vergleichswert und liefert null statt des Mittels seit dem Start.
    private int? ReadCpuLoad()
    {
        if (!GetSystemTimes(out var idle, out var kernel, out var user))
        {
            return null;
        }

        // Kernelzeit enthaelt die Leerlaufzeit bereits.
        var total = kernel + user;
        var load = previousTotal == 0 || total == previousTotal
            ? (int?)null
            : (int)Math.Round(100.0 * (1 - (double)(idle - previousIdle) / (total - previousTotal)));
        previousIdle = idle;
        previousTotal = total;
        return load is null ? null : Math.Clamp(load.Value, 0, 100);
    }

    private int? ReadGpuLoad(bool resumed)
    {
        if (gpuCounterUnavailable)
        {
            return null;
        }

        if (gpuQuery == IntPtr.Zero)
        {
            if (PdhOpenQuery(null, IntPtr.Zero, out gpuQuery) != 0
                || PdhAddEnglishCounter(gpuQuery, @"\GPU Engine(*)\Utilization Percentage", IntPtr.Zero, out gpuCounter) != 0)
            {
                // Ohne WDDM-2-Grafiktreiber gibt es den Indikator nicht - dann nie wieder versuchen.
                gpuCounterUnavailable = true;
                return null;
            }
        }

        // Nach einer Pause setzt diese Abfrage nur den neuen Vergleichswert.
        if (PdhCollectQueryData(gpuQuery) != 0 || resumed)
        {
            return null;
        }

        // Zwischen Groessenabfrage und Lesen koennen Prozesse dazukommen - dann noch einmal.
        for (var attempt = 0; attempt < 3; attempt++)
        {
            uint bufferSize = 0;
            if (PdhGetFormattedCounterArray(gpuCounter, PdhFormatDouble, ref bufferSize, out _, IntPtr.Zero) != PdhMoreData)
            {
                return null;
            }

            var buffer = Marshal.AllocHGlobal((int)bufferSize);
            try
            {
                var status = PdhGetFormattedCounterArray(gpuCounter, PdhFormatDouble, ref bufferSize, out var itemCount, buffer);
                if (status == PdhMoreData)
                {
                    continue;
                }

                if (status != 0)
                {
                    return null;
                }

                var itemSize = Marshal.SizeOf<PdhCounterValueItem>();
                var samples = new List<(string, double)>((int)itemCount);
                for (var index = 0; index < itemCount; index++)
                {
                    var item = Marshal.PtrToStructure<PdhCounterValueItem>(buffer + index * itemSize);
                    // 0 = gueltig, 1 = neuer Wert; die erste Abfrage eines Ratenzaehlers hat noch keinen.
                    if (item.Value.Status <= 1)
                    {
                        samples.Add((Marshal.PtrToStringUni(item.Name) ?? string.Empty, item.Value.Value));
                    }
                }

                return SumGpuLoad(samples);
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        return null;
    }

    // Instanzen heissen "pid_1234_luid_0x..._0x..._phys_0_eng_3_engtype_3D": eine pro Prozess und
    // Engine. Wie der Task-Manager: pro Engine ueber alle Prozesse summieren, die vollste Engine zaehlt.
    // ponytail: ein Wert fuer alle Grafikkarten zusammen; pro Karte erst, wenn jemand iGPU und
    // dGPU getrennt sehen will.
    internal static int? SumGpuLoad(IEnumerable<(string Instance, double Value)> samples)
    {
        var perEngine = new Dictionary<string, double>();
        foreach (var (instance, value) in samples)
        {
            var engineStart = instance.IndexOf("luid_", StringComparison.Ordinal);
            if (engineStart >= 0)
            {
                var engine = instance[engineStart..];
                perEngine[engine] = perEngine.GetValueOrDefault(engine) + value;
            }
        }

        return perEngine.Count == 0 ? null : (int)Math.Round(Math.Min(perEngine.Values.Max(), 100));
    }

    // Dieselbe Quelle wie die GPU-Temperatur im Task-Manager. Integrierte Grafik meldet meist 0 -
    // dann null statt "0 Grad".
    private static int? ReadGpuTemperature()
    {
        var enumeration = new EnumAdapters2();
        if (D3DKMTEnumAdapters2(ref enumeration) != 0 || enumeration.NumAdapters == 0)
        {
            return null;
        }

        var adapterSize = Marshal.SizeOf<AdapterInfo>();
        var adapters = Marshal.AllocHGlobal(adapterSize * (int)enumeration.NumAdapters);
        var perfDataSize = Marshal.SizeOf<AdapterPerfData>();
        var perfData = Marshal.AllocHGlobal(perfDataSize);
        try
        {
            enumeration.Adapters = adapters;
            if (D3DKMTEnumAdapters2(ref enumeration) != 0)
            {
                return null;
            }

            int? hottest = null;
            for (var index = 0; index < enumeration.NumAdapters; index++)
            {
                var adapter = Marshal.PtrToStructure<AdapterInfo>(adapters + index * adapterSize);
                Marshal.StructureToPtr(new AdapterPerfData(), perfData, fDeleteOld: false);
                var query = new QueryAdapterInfo
                {
                    Adapter = adapter.Adapter,
                    Type = KmtQueryAdapterPerfData,
                    PrivateDriverData = perfData,
                    PrivateDriverDataSize = (uint)perfDataSize
                };

                if (D3DKMTQueryAdapterInfo(ref query) == 0
                    && Marshal.PtrToStructure<AdapterPerfData>(perfData).Temperature is > 0 and var deciCelsius)
                {
                    hottest = Math.Max(hottest ?? 0, (int)Math.Round(deciCelsius / 10.0));
                }

                var close = new CloseAdapter { Adapter = adapter.Adapter };
                D3DKMTCloseAdapter(ref close);
            }

            return hottest;
        }
        finally
        {
            Marshal.FreeHGlobal(perfData);
            Marshal.FreeHGlobal(adapters);
        }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSystemTimes(out long idleTime, out long kernelTime, out long userTime);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx buffer);

    [DllImport("pdh.dll", EntryPoint = "PdhOpenQueryW", CharSet = CharSet.Unicode)]
    private static extern int PdhOpenQuery(string? dataSource, IntPtr userData, out IntPtr query);

    [DllImport("pdh.dll", EntryPoint = "PdhAddEnglishCounterW", CharSet = CharSet.Unicode)]
    private static extern int PdhAddEnglishCounter(IntPtr query, string counterPath, IntPtr userData, out IntPtr counter);

    [DllImport("pdh.dll")]
    private static extern int PdhCollectQueryData(IntPtr query);

    [DllImport("pdh.dll", EntryPoint = "PdhGetFormattedCounterArrayW", CharSet = CharSet.Unicode)]
    private static extern int PdhGetFormattedCounterArray(
        IntPtr counter,
        uint format,
        ref uint bufferSize,
        out uint itemCount,
        IntPtr itemBuffer);

    [DllImport("pdh.dll")]
    private static extern int PdhCloseQuery(IntPtr query);

    [DllImport("gdi32.dll")]
    private static extern int D3DKMTEnumAdapters2(ref EnumAdapters2 enumAdapters);

    [DllImport("gdi32.dll")]
    private static extern int D3DKMTQueryAdapterInfo(ref QueryAdapterInfo queryAdapterInfo);

    [DllImport("gdi32.dll")]
    private static extern int D3DKMTCloseAdapter(ref CloseAdapter closeAdapter);

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryStatusEx
    {
        public uint Length;
        public uint MemoryLoad;
        public ulong TotalPhys;
        public ulong AvailPhys;
        public ulong TotalPageFile;
        public ulong AvailPageFile;
        public ulong TotalVirtual;
        public ulong AvailVirtual;
        public ulong AvailExtendedVirtual;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PdhCounterValueItem
    {
        public IntPtr Name;
        public PdhCounterValue Value;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PdhCounterValue
    {
        public uint Status;
        public double Value;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct EnumAdapters2
    {
        public uint NumAdapters;
        public IntPtr Adapters;
    }

    // LUID besteht aus zwei 32-Bit-Feldern und ist nur 4-Byte-ausgerichtet - ein long verschoebe
    // alle folgenden Felder.
    [StructLayout(LayoutKind.Sequential)]
    private struct AdapterInfo
    {
        public uint Adapter;
        public uint LuidLowPart;
        public int LuidHighPart;
        public uint NumOfSources;
        public int PrecisePresentRegionsPreferred;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct QueryAdapterInfo
    {
        public uint Adapter;
        public int Type;
        public IntPtr PrivateDriverData;
        public uint PrivateDriverDataSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct CloseAdapter
    {
        public uint Adapter;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct AdapterPerfData
    {
        public uint PhysicalAdapterIndex;
        public ulong MemoryFrequency;
        public ulong MaxMemoryFrequency;
        public ulong MaxMemoryFrequencyOverclocked;
        public ulong MemoryBandwidth;
        public ulong PcieBandwidth;
        public uint FanRpm;
        public uint Power;
        public uint Temperature;
        public byte PowerStateOverride;
    }
}
