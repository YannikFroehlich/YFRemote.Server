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

    // Energiemodus der Windows-Einstellungen (Beste Energieeffizienz / Ausgeglichen / Beste Leistung):
    // ein "Overlay" ueber dem Energiesparplan, das nur mit dem Plan "Ausbalanciert" wirkt - mit einem
    // anderen Plan bietet Windows den Regler selbst nicht an, dann auch YFRemote nicht. Die Overlay-
    // Funktionen sind nicht dokumentiert, aber seit Windows 10 1709 exportiert; die Einstellungen-App
    // nutzt dieselben.
    private static readonly Guid BalancedScheme = new("381b4222-f694-41f0-9685-ff5bb260df2e");
    private static readonly (string Mode, Guid Overlay)[] PowerModes =
    [
        ("efficiency", new Guid("961cc777-2547-4f9d-8174-7d86181b8a7a")),
        ("balanced", Guid.Empty),
        ("performance", new Guid("ded574b5-45a0-4f42-8737-46345c09c238")),
    ];

    public string? PowerMode
    {
        get
        {
            if (PowerGetActiveScheme(0, out var schemePointer) != 0)
            {
                return null;
            }

            Guid scheme;
            try
            {
                scheme = Marshal.PtrToStructure<Guid>(schemePointer);
            }
            finally
            {
                LocalFree(schemePointer);
            }

            if (scheme != BalancedScheme || PowerGetEffectiveOverlayScheme(out var overlay) != 0)
            {
                return null;
            }

            return PowerModes.FirstOrDefault(entry => entry.Overlay == overlay).Mode;
        }
    }

    public void SetPowerMode(string mode)
    {
        if (PowerMode is null)
        {
            throw new NotSupportedException("Power mode needs the Balanced power plan.");
        }

        var result = PowerSetActiveOverlayScheme(PowerModes.First(entry => entry.Mode == mode).Overlay);
        if (result != 0)
        {
            throw new Win32Exception((int)result, "Setting the power mode failed.");
        }
    }

    [DllImport("powrprof.dll")]
    private static extern uint PowerGetActiveScheme(nint userRootPowerKey, out nint activePolicyGuid);

    [DllImport("powrprof.dll")]
    private static extern uint PowerGetEffectiveOverlayScheme(out Guid effectiveOverlayPolicyGuid);

    [DllImport("powrprof.dll")]
    private static extern uint PowerSetActiveOverlayScheme(Guid overlaySchemeGuid);

    [DllImport("kernel32.dll")]
    private static extern nint LocalFree(nint memory);

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
