using System.ComponentModel;
using System.Runtime.InteropServices;

namespace YFRemote.Server.Services;

// Die Monitore in physischen Pixeln, gemeinsam fuer Aufnahme und screenClick: nur wenn beide
// dieselben Grenzen sehen, landet ein Tipp dort, wo er im Bild war.
internal static class WindowsMonitors
{
    private const int MonitorInfoPrimary = 1;
    private static readonly IntPtr DpiAwarenessContextPerMonitorAwareV2 = -4;

    public static IReadOnlyList<ScreenMonitor> List() => [.. Enumerate().Select(entry => entry.Monitor)];

    // Mit dem HMONITOR fuer DDC/CI (WindowsBrightnessService); gilt nur bis zur naechsten Aenderung der Anzeige.
    public static IReadOnlyList<(IntPtr Handle, ScreenMonitor Monitor)> Enumerate()
    {
        var previousDpiContext = SetThreadDpiAwarenessContext(DpiAwarenessContextPerMonitorAwareV2);
        try
        {
            var monitors = new List<(IntPtr Handle, ScreenMonitor Monitor)>();
            EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (handle, _, _, _) =>
            {
                var info = new MonitorInfoEx { Size = Marshal.SizeOf<MonitorInfoEx>() };
                if (GetMonitorInfo(handle, ref info))
                {
                    monitors.Add((handle, new ScreenMonitor(
                        info.Device,
                        info.Left,
                        info.Top,
                        info.Right - info.Left,
                        info.Bottom - info.Top,
                        (info.Flags & MonitorInfoPrimary) != 0)));
                }

                return true;
            }, IntPtr.Zero);
            return [.. monitors.OrderBy(entry => entry.Monitor.Left).ThenBy(entry => entry.Monitor.Top)];
        }
        finally
        {
            SetThreadDpiAwarenessContext(previousDpiContext);
        }
    }

    public static ScreenMonitor Find(string? id) =>
        ScreenMonitor.Resolve(List(), id) ?? throw new Win32Exception("Kein Bildschirm gefunden.");

    private delegate bool MonitorEnumProc(IntPtr monitor, IntPtr deviceContext, IntPtr rectangle, IntPtr data);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MonitorInfoEx
    {
        public int Size;
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
        public int WorkLeft;
        public int WorkTop;
        public int WorkRight;
        public int WorkBottom;
        public int Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string Device;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(IntPtr deviceContext, IntPtr clip, MonitorEnumProc callback, IntPtr data);

    [DllImport("user32.dll", EntryPoint = "GetMonitorInfoW", CharSet = CharSet.Unicode)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfoEx info);

    [DllImport("user32.dll")]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
}
