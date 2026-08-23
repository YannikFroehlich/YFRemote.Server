namespace YFRemote.Server.Diagnostics;

internal static class DiagnosticPaths
{
    public static string LogDirectory => GetLogDirectory(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));

    public static string RollingLogFilePath => Path.Combine(LogDirectory, "yfremote-.log");

    public static string StartupErrorLogFilePath => Path.Combine(LogDirectory, "startup-error.log");

    public static string EnsureLogDirectory()
    {
        Directory.CreateDirectory(LogDirectory);
        return LogDirectory;
    }

    internal static string GetLogDirectory(string localApplicationData)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(localApplicationData);
        return Path.Combine(localApplicationData, "YFRemote", "Logs");
    }
}
