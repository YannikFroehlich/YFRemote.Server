using System.Diagnostics;

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
