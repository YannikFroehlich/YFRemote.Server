using Microsoft.Win32;

namespace YFRemote.Server.Services;

internal static class WindowsStartupService
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "YFRemote";
    private const string LauncherFileName = "YFRemote.exe";

    public static bool IsAvailable => GetLauncherPath() is not null;

    public static bool IsEnabled()
    {
        var launcherPath = GetLauncherPath();
        if (launcherPath is null)
        {
            return false;
        }

        using var runKey = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
        var configuredCommand = runKey?.GetValue(ValueName) as string;

        return string.Equals(
            NormalizeCommand(configuredCommand),
            launcherPath,
            StringComparison.OrdinalIgnoreCase);
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
            $"\"{launcherPath}\"",
            RegistryValueKind.String);
    }

    private static string? GetLauncherPath()
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

    private static string? NormalizeCommand(string? command)
    {
        if (string.IsNullOrWhiteSpace(command))
        {
            return null;
        }

        var path = command.Trim();
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
