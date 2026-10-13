using System.Diagnostics;

namespace YFRemote.Server.Services;

public sealed class LinuxPowerService : IPowerService
{
    private const int CommandTimeoutMs = 5000;

    public void Shutdown() => RunSystemctl("poweroff");

    public void Restart() => RunSystemctl("reboot");

    public void Sleep() => RunSystemctl("suspend");

    // lock-sessions statt lock-session: der systemd-User-Dienst gehoert zu keiner Sitzung.
    public void Lock() => Run("loginctl", "lock-sessions");

    // Unter Wayland gibt es dafuer keinen compositor-uebergreifenden Weg.
    public void TurnOffDisplay() =>
        throw new NotSupportedException("Turning off the display is not supported on Linux.");

    // ponytail: systemctl deckt jedes systemd-System ab; fuer Init-Systeme ohne systemd waere
    // ein Fallback auf /sys/power/state bzw. shutdown(8) noetig.
    private static void RunSystemctl(string verb) => Run("systemctl", verb);

    private static void Run(string fileName, string arguments)
    {
        using var process = Process.Start(new ProcessStartInfo(fileName, arguments)
        {
            UseShellExecute = false,
            CreateNoWindow = true
        }) ?? throw new InvalidOperationException($"Failed to start {fileName}.");

        // Ohne die Exit-Code-Pruefung wuerde ein abgelehnter Befehl (fehlende Polkit-Berechtigung)
        // als Erfolg quittiert werden.
        if (process.WaitForExit(CommandTimeoutMs) && process.ExitCode != 0)
        {
            throw new InvalidOperationException($"{fileName} {arguments} exited with code {process.ExitCode}.");
        }
    }
}
