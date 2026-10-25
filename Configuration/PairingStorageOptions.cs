namespace YFRemote.Server.Configuration;

public sealed class PairingStorageOptions
{
    public const string SectionName = "PairingStorage";

    public string DevicesFilePath { get; init; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "YFRemote",
        "devices.json");

    public TimeSpan PinLifetime { get; init; } = TimeSpan.FromMinutes(10);

    public TimeSpan LockoutDuration { get; init; } = TimeSpan.FromSeconds(60);

    public TimeSpan LastSeenPersistenceInterval { get; init; } = TimeSpan.FromMinutes(5);

    // Ein Geraet, das so lange nicht verbunden war, wird entkoppelt (verlorenes oder verkauftes
    // Handy). 0 schaltet das ab.
    public TimeSpan DeviceExpiry { get; init; } = TimeSpan.FromDays(90);

    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(DevicesFilePath))
        {
            throw new InvalidOperationException("Pairing devices file path must not be empty.");
        }

        if (PinLifetime <= TimeSpan.Zero)
        {
            throw new InvalidOperationException("Pairing PIN lifetime must be positive.");
        }

        if (LockoutDuration <= TimeSpan.Zero)
        {
            throw new InvalidOperationException("Pairing lockout duration must be positive.");
        }

        if (LastSeenPersistenceInterval <= TimeSpan.Zero)
        {
            throw new InvalidOperationException("Last-seen persistence interval must be positive.");
        }

        if (DeviceExpiry < TimeSpan.Zero)
        {
            throw new InvalidOperationException("Device expiry must not be negative.");
        }
    }
}
