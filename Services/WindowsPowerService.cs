using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace YFRemote.Server.Services;

public sealed class WindowsPowerService : IPowerService
{
    private const int CommandTimeoutMs = 5000;

    public void Shutdown() => RunShutdown("/s /t 0");

    public void Restart() => RunShutdown("/r /t 0");

    // Nicht ueber shutdown.exe: /h waere Ruhezustand (Hibernate), einen echten Standby kann
    // shutdown.exe gar nicht ausloesen.
    // ponytail: bei aktiviertem Hybrid-Standby entscheidet Windows selbst, ob daraus doch ein
    // Ruhezustand wird - bei Bedarf ueber eine powercfg-Abfrage nachsteuern.
    public void Sleep()
    {
        if (!Application.SetSuspendState(PowerState.Suspend, force: false, disableWakeEvent: false))
        {
            throw new InvalidOperationException("SetSuspendState was refused by Windows.");
        }
    }

    // Win+L laesst sich per SendInput nicht ausloesen, Windows filtert die Kombination heraus.
    public void Lock()
    {
        if (!LockWorkStation())
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "LockWorkStation failed.");
        }
    }

    // PostMessage statt SendMessage: ein haengendes Fenster wuerde den Broadcast sonst blockieren.
    public void TurnOffDisplay()
    {
        if (!PostMessage(HwndBroadcast, WmSysCommand, ScMonitorPower, MonitorOff))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Turning off the display failed.");
        }
    }

    private const nint HwndBroadcast = 0xFFFF;
    private const uint WmSysCommand = 0x0112;
    private const nint ScMonitorPower = 0xF170;
    private const nint MonitorOff = 2;

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool LockWorkStation();

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessage(nint window, uint message, nint wParam, nint lParam);

    private static void RunShutdown(string arguments)
    {
        using var process = Process.Start(new ProcessStartInfo("shutdown.exe", arguments)
        {
            UseShellExecute = false,
            CreateNoWindow = true
        }) ?? throw new InvalidOperationException("Failed to start shutdown.exe.");

        // shutdown.exe kehrt sofort zurueck, das Herunterfahren laeuft danach weiter. Ohne die
        // Exit-Code-Pruefung wuerde ein abgelehnter Befehl (z. B. fehlendes Recht) als Erfolg
        // quittiert werden.
        if (process.WaitForExit(CommandTimeoutMs) && process.ExitCode != 0)
        {
            throw new InvalidOperationException($"shutdown.exe exited with code {process.ExitCode}.");
        }
    }
}
