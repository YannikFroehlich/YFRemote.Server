using System.Diagnostics;

namespace YFRemote.Server.Services;

public sealed class LinuxPowerService : IPowerService
{
    private const int CommandTimeoutMs = 5000;

    public void Shutdown() => RunSystemctl("poweroff");

    public void Restart() => RunSystemctl("reboot");

    public void Sleep() => RunSystemctl("suspend");

    // ponytail: systemctl deckt jedes systemd-System ab; fuer Init-Systeme ohne systemd waere
    // ein Fallback auf /sys/power/state bzw. shutdown(8) noetig.
    private static void RunSystemctl(string verb)
    {
        using var process = Process.Start(new ProcessStartInfo("systemctl", verb)
        {
            UseShellExecute = false,
            CreateNoWindow = true
        }) ?? throw new InvalidOperationException("Failed to start systemctl.");

        // Ohne die Exit-Code-Pruefung wuerde ein abgelehnter Befehl (fehlende Polkit-Berechtigung)
        // als Erfolg quittiert werden.
        if (process.WaitForExit(CommandTimeoutMs) && process.ExitCode != 0)
        {
            throw new InvalidOperationException($"systemctl {verb} exited with code {process.ExitCode}.");
        }
    }
}
