namespace YFRemote.Server.Configuration;

public sealed class SystemStatsOptions
{
    public const string SectionName = "SystemStats";

    // Port des "Remote Web Server" von LibreHardwareMonitor (dort einstellbar, Standard 8085),
    // siehe WindowsSystemStatsReader.
    public int SensorToolPort { get; init; } = 8085;

    public void Validate()
    {
        if (SensorToolPort is < 1 or > 65535)
        {
            throw new InvalidOperationException("SystemStats:SensorToolPort must be between 1 and 65535.");
        }
    }
}
