using Microsoft.Win32;

namespace YFRemote.Server.Services;

internal static class WindowsStartupService
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "YFRemote";
    private const string LauncherFileName = "YFRemote.exe";

    // Beim Windows-Start bleibt YFRemote im Infobereich; jeder andere Start oeffnet das Fenster.
    internal const string AutostartArgument = "--autostart";

    public static bool IsAvailable => GetLauncherPath() is not null;

    public static bool IsEnabled()
    {
        var launcherPath = GetLauncherPath();
        if (launcherPath is null)
        {
            return false;
        }

        return string.Equals(
            NormalizeCommand(ReadCommand()),
            launcherPath,
            StringComparison.OrdinalIgnoreCase);
    }

    // Eintraege aelterer Versionen ohne --autostart wuerden nach dem Update bei jeder Anmeldung
    // das Fenster oeffnen.
    public static void UpgradeCommand()
    {
        if (IsEnabled() && ReadCommand()?.TrimEnd().EndsWith(AutostartArgument, StringComparison.Ordinal) != true)
        {
            SetEnabled(true);
        }
    }

    private static string? ReadCommand()
    {
        using var runKey = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
        return runKey?.GetValue(ValueName) as string;
    }

    public static void SetEnabled(bool enabled)
    {
        if (!enabled)
        {
            using var runKey = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
            runKey?.DeleteValue(ValueName, throwOnMissingValue: false);
            return;
        }

        var launcherPath = GetLauncherPath()
            ?? throw new InvalidOperationException(
                "Autostart ist nur für eine installierte YFRemote-Version verfügbar.");

        using var writableRunKey = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true)
            ?? throw new InvalidOperationException(
                "Der Windows-Autostart konnte nicht geöffnet werden.");

        writableRunKey.SetValue(
            ValueName,
            $"\"{launcherPath}\" {AutostartArgument}",
            RegistryValueKind.String);
    }

    internal static string? GetLauncherPath()
    {
        var appDirectoryPath = AppContext.BaseDirectory.TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar);
        var appDirectory = new DirectoryInfo(appDirectoryPath);

        if (!string.Equals(appDirectory.Name, "current", StringComparison.OrdinalIgnoreCase)
            || appDirectory.Parent is null)
        {
            return null;
        }

        var launcherPath = Path.Combine(appDirectory.Parent.FullName, LauncherFileName);
        return File.Exists(launcherPath)
            ? Path.GetFullPath(launcherPath)
            : null;
    }

    internal static string? NormalizeCommand(string? command)
    {
        if (string.IsNullOrWhiteSpace(command))
        {
            return null;
        }

        var path = command.Trim();
        if (path.EndsWith(" " + AutostartArgument, StringComparison.Ordinal))
        {
            path = path[..^AutostartArgument.Length].TrimEnd();
        }

        if (path.Length >= 2 && path[0] == '"' && path[^1] == '"')
        {
            path = path[1..^1];
        }

        try
        {
            return Path.GetFullPath(path);
        }
        catch (Exception exception) when (
            exception is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return null;
        }
    }
}
