using System.Runtime.InteropServices;

namespace YFRemote.Server.Services;

// Das eingebaute Laptop-Display per WMI (wie der Regler im Info-Center), externe Monitore per
// DDC/CI (dxva2) - ein Laptop-Panel beantwortet DDC/CI nicht, ein externer Monitor kein WMI. Das
// Panel ist ein eigener Eintrag "internal", weil sich der WMI-Eintrag nicht verlaesslich einem
// HMONITOR zuordnen laesst (unter Parsec fehlt dem aktiven Display jedes Monitorgeraet). DDC/CI laeuft
// ueber I2C und braucht je Monitor einige 10 ms, deshalb nur auf Abruf und nie gleichzeitig.
internal sealed class WindowsBrightnessService(ILogger<WindowsBrightnessService> logger) : IBrightnessService
{
    public const string InternalId = "internal";

    private readonly Lock gate = new();

    public IReadOnlyList<MonitorBrightness> List()
    {
        lock (gate)
        {
            var result = new List<MonitorBrightness>();
            if (ReadPanel() is { } panel)
            {
                result.Add(new MonitorBrightness(InternalId, panel));
            }

            foreach (var (handle, monitor) in WindowsMonitors.Enumerate())
            {
                if (ReadDdc(handle) is { } level)
                {
                    result.Add(new MonitorBrightness(monitor.Id, level));
                }
            }

            return result;
        }
    }

    public bool TrySet(string id, int percent)
    {
        lock (gate)
        {
            if (id == InternalId)
            {
                return SetPanel(percent);
            }

            var handle = WindowsMonitors.Enumerate().FirstOrDefault(entry => entry.Monitor.Id == id).Handle;
            return handle != IntPtr.Zero && SetDdc(handle, percent);
        }
    }

    private int? ReadPanel()
    {
        try
        {
            foreach (dynamic item in Wmi().ExecQuery("SELECT CurrentBrightness FROM WmiMonitorBrightness WHERE Active = TRUE"))
            {
                return Convert.ToInt32(item.Properties_.Item("CurrentBrightness").Value);
            }
        }
        catch (Exception ex)
        {
            // Ein Desktop-PC hat die Klasse nicht ("Nicht unterstuetzt") - dann gibt es eben kein Panel.
            logger.LogDebug(ex, "No built-in display brightness.");
        }

        return null;
    }

    private bool SetPanel(int percent)
    {
        try
        {
            var set = false;
            foreach (dynamic item in Wmi().ExecQuery("SELECT * FROM WmiMonitorBrightnessMethods WHERE Active = TRUE"))
            {
                item.WmiSetBrightness(1, (byte)percent);
                set = true;
            }

            return set;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Setting the built-in display brightness failed.");
            return false;
        }
    }

    private static dynamic Wmi()
    {
        dynamic locator = Activator.CreateInstance(Type.GetTypeFromProgID("WbemScripting.SWbemLocator", throwOnError: true)!)!;
        return locator.ConnectServer(".", @"root\wmi");
    }

    private static int? ReadDdc(IntPtr monitor) => WithPhysicalMonitors(monitor, handles =>
    {
        foreach (var handle in handles)
        {
            if (GetMonitorBrightness(handle, out var min, out var current, out var max) && max > min)
            {
                return (int?)Math.Round((current - min) * 100.0 / (max - min));
            }
        }

        return null;
    });

    // Ein gespiegelter Bildschirm sind mehrere physische Monitore an einem HMONITOR - alle bekommen den Wert.
    private static bool SetDdc(IntPtr monitor, int percent) => WithPhysicalMonitors(monitor, handles =>
    {
        var set = false;
        foreach (var handle in handles)
        {
            if (GetMonitorBrightness(handle, out var min, out _, out var max) && max > min)
            {
                set |= SetMonitorBrightness(handle, (uint)(min + Math.Round((max - min) * percent / 100.0)));
            }
        }

        return set;
    });

    private static T? WithPhysicalMonitors<T>(IntPtr monitor, Func<IEnumerable<IntPtr>, T> use)
    {
        if (!GetNumberOfPhysicalMonitorsFromHMONITOR(monitor, out var count) || count == 0)
        {
            return default;
        }

        var monitors = new PhysicalMonitor[count];
        if (!GetPhysicalMonitorsFromHMONITOR(monitor, count, monitors))
        {
            return default;
        }

        try
        {
            return use(monitors.Select(physical => physical.Handle));
        }
        finally
        {
            DestroyPhysicalMonitors(count, monitors);
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PhysicalMonitor
    {
        public IntPtr Handle;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string Description;
    }

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr monitor, out uint count);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr monitor, uint count, [Out] PhysicalMonitor[] monitors);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool DestroyPhysicalMonitors(uint count, PhysicalMonitor[] monitors);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetMonitorBrightness(IntPtr monitor, out uint minimum, out uint current, out uint maximum);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool SetMonitorBrightness(IntPtr monitor, uint brightness);
}
