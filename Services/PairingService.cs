using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using YFRemote.Server.Configuration;
using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

public sealed class PairingService
{
    private const int PinLength = 6;
    private const int MaxFailedAttempts = 5;
    private const int MaxDeviceNameLength = 60;
    private const string DefaultDeviceName = "Unbekanntes Gerät";

    private readonly ILogger<PairingService> logger;
    private readonly PairingStorageOptions options;
    private readonly TimeProvider timeProvider;
    private readonly string devicesFilePath;
    private readonly string backupFilePath;
    private readonly string lockoutsFilePath;
    private readonly object syncRoot = new();
    private readonly List<PairedDeviceRecord> devices;
    private readonly Dictionary<string, FailedAttemptState> failedAttemptsByIp;

    private (string Pin, DateTimeOffset ExpiresAtUtc) pinState;
    private DateTimeOffset nextLastSeenPersistenceUtc;
    private bool primaryFileIsValid;

    public PairingService(
        ILogger<PairingService> logger,
        PairingStorageOptions options,
        TimeProvider timeProvider)
    {
        options.Validate();

        this.logger = logger;
        this.options = options;
        this.timeProvider = timeProvider;
        devicesFilePath = Path.GetFullPath(options.DevicesFilePath);
        backupFilePath = $"{devicesFilePath}.bak";
        lockoutsFilePath = Path.Combine(
            Path.GetDirectoryName(devicesFilePath) ?? ".",
            "pairing-lockouts.json");
        devices = LoadDevices(out primaryFileIsValid);
        failedAttemptsByIp = LoadFailedAttempts();

        var now = UtcNow;
        pinState = GenerateNewPin(now);
        nextLastSeenPersistenceUtc = now.Add(options.LastSeenPersistenceInterval);
    }

    public (string Pin, DateTimeOffset ExpiresAtUtc) GetCurrentPin()
    {
        lock (syncRoot)
        {
            EnsurePinValid();
            return pinState;
        }
    }

    public (string Pin, DateTimeOffset ExpiresAtUtc) RegeneratePin()
    {
        lock (syncRoot)
        {
            pinState = GenerateNewPin(UtcNow);
            return pinState;
        }
    }

    public PairResponse TryPair(PairRequest? request, string clientIp)
    {
        var pin = request?.Pin?.Trim();

        if (string.IsNullOrEmpty(pin) || pin.Length != PinLength || !pin.All(char.IsAsciiDigit))
        {
            return PairResponse.Fail("PIN muss aus 6 Ziffern bestehen.");
        }

        lock (syncRoot)
        {
            var now = UtcNow;
            if (TryGetLockout(clientIp, now, out var lockedUntilUtc))
            {
                var secondsRemaining =
                    Math.Max(1, (int)Math.Ceiling((lockedUntilUtc - now).TotalSeconds));
                return PairResponse.Fail($"Zu viele Fehlversuche. Erneut versuchen in {secondsRemaining}s.");
            }

            EnsurePinValid(now);

            if (!string.Equals(pin, pinState.Pin, StringComparison.Ordinal))
            {
                RegisterFailedAttempt(clientIp, now);
                return PairResponse.Fail("PIN ungültig.");
            }

            failedAttemptsByIp.Remove(clientIp);
            TryPersistFailedAttempts();

            var token = GenerateDeviceToken();
            var deviceName = NormalizeDeviceName(request!.DeviceName);
            var device = new PairedDeviceRecord(
                Guid.NewGuid(),
                deviceName,
                HashToken(token),
                now,
                now);

            devices.Add(device);
            if (!TryPersistDevices())
            {
                devices.Remove(device);
                return PairResponse.Fail(
                    "Kopplung konnte nicht dauerhaft gespeichert werden. Bitte erneut versuchen.");
            }

            // Eine erfolgreich verwendete PIN darf kein weiteres Gerät koppeln. Eine neue
            // PIN wird erst erzeugt, nachdem der neue Geräteeintrag sicher gespeichert ist.
            pinState = GenerateNewPin(now);
            nextLastSeenPersistenceUtc = now.Add(options.LastSeenPersistenceInterval);

            logger.LogInformation("Device paired: {DeviceName} from {ClientIp}", deviceName, clientIp);

            return PairResponse.Ok(token);
        }
    }

    public bool IsValidToken(string? token)
    {
        return TryValidateToken(token, out _);
    }

    public bool TryValidateToken(string? token, out Guid deviceId)
    {
        deviceId = default;

        if (string.IsNullOrEmpty(token))
        {
            return false;
        }

        var tokenHash = HashToken(token);

        lock (syncRoot)
        {
            var index = devices.FindIndex(device => device.TokenHash == tokenHash);
            if (index < 0)
            {
                return false;
            }

            var now = UtcNow;
            devices[index] = devices[index] with { LastSeenUtc = now };
            deviceId = devices[index].Id;

            if (now >= nextLastSeenPersistenceUtc)
            {
                TryPersistDevices();
                nextLastSeenPersistenceUtc = now.Add(options.LastSeenPersistenceInterval);
            }

            return true;
        }
    }

    public IReadOnlyList<PairedDeviceInfo> GetPairedDevices()
    {
        lock (syncRoot)
        {
            return devices
                .Select(device => new PairedDeviceInfo(device.Id, device.Name, device.PairedAtUtc, device.LastSeenUtc))
                .ToList();
        }
    }

    public bool RemoveDevice(Guid deviceId)
    {
        lock (syncRoot)
        {
            var index = devices.FindIndex(device => device.Id == deviceId);
            return RemoveDeviceAt(index) == PairingRemovalResult.Removed;
        }
    }

    public PairingRemovalResult RemoveDeviceByToken(string? token, out Guid deviceId)
    {
        deviceId = default;

        if (string.IsNullOrEmpty(token))
        {
            return PairingRemovalResult.NotFound;
        }

        var tokenHash = HashToken(token);

        lock (syncRoot)
        {
            var index = devices.FindIndex(device => device.TokenHash == tokenHash);
            if (index >= 0)
            {
                deviceId = devices[index].Id;
            }

            return RemoveDeviceAt(index);
        }
    }

    private PairingRemovalResult RemoveDeviceAt(int index)
    {
        if (index < 0)
        {
            return PairingRemovalResult.NotFound;
        }

        var removedDevice = devices[index];
        devices.RemoveAt(index);

        if (!TryPersistDevices())
        {
            devices.Insert(index, removedDevice);
            return PairingRemovalResult.PersistenceFailed;
        }

        nextLastSeenPersistenceUtc = UtcNow.Add(options.LastSeenPersistenceInterval);
        logger.LogInformation("Device unpaired: {DeviceName} ({DeviceId})", removedDevice.Name, removedDevice.Id);
        return PairingRemovalResult.Removed;
    }

    private DateTimeOffset UtcNow => timeProvider.GetUtcNow();

    private void EnsurePinValid()
    {
        EnsurePinValid(UtcNow);
    }

    private void EnsurePinValid(DateTimeOffset now)
    {
        if (now >= pinState.ExpiresAtUtc)
        {
            pinState = GenerateNewPin(now);
        }
    }

    private bool TryGetLockout(
        string clientIp,
        DateTimeOffset now,
        out DateTimeOffset lockedUntilUtc)
    {
        if (failedAttemptsByIp.TryGetValue(clientIp, out var state)
            && state.Count >= MaxFailedAttempts
            && now < state.LockedUntilUtc)
        {
            lockedUntilUtc = state.LockedUntilUtc;
            return true;
        }

        lockedUntilUtc = default;
        return false;
    }

    private void RegisterFailedAttempt(string clientIp, DateTimeOffset now)
    {
        var previousCount = failedAttemptsByIp.TryGetValue(clientIp, out var state) ? state.Count : 0;
        var newCount = previousCount + 1;
        var lockedUntilUtc = newCount >= MaxFailedAttempts
            ? now.Add(options.LockoutDuration)
            : DateTimeOffset.MinValue;

        failedAttemptsByIp[clientIp] = new FailedAttemptState(newCount, lockedUntilUtc);
        TryPersistFailedAttempts();
    }

    private (string Pin, DateTimeOffset ExpiresAtUtc) GenerateNewPin(DateTimeOffset now)
    {
        var pin = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        return (pin, now.Add(options.PinLifetime));
    }

    private static string GenerateDeviceToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    private static string HashToken(string token)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return Convert.ToBase64String(hash);
    }

    private static string NormalizeDeviceName(string? name)
    {
        var trimmed = name?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return DefaultDeviceName;
        }

        return trimmed.Length > MaxDeviceNameLength ? trimmed[..MaxDeviceNameLength] : trimmed;
    }

    private List<PairedDeviceRecord> LoadDevices(out bool loadedFromPrimaryFile)
    {
        if (TryLoadDevicesFile(devicesFilePath, out var storedDevices))
        {
            loadedFromPrimaryFile = true;
            return storedDevices;
        }

        if (TryLoadDevicesFile(backupFilePath, out var backupDevices))
        {
            loadedFromPrimaryFile = false;
            logger.LogWarning(
                "Recovered paired devices from backup file {BackupFilePath}.",
                backupFilePath);
            return backupDevices;
        }

        loadedFromPrimaryFile = false;
        return [];
    }

    private bool TryLoadDevicesFile(string path, out List<PairedDeviceRecord> storedDevices)
    {
        storedDevices = [];
        if (!File.Exists(path))
        {
            return false;
        }

        try
        {
            var json = File.ReadAllText(path);
            var file = JsonSerializer.Deserialize<DevicesFile>(json)
                ?? throw new JsonException("Pairing devices file is empty.");

            storedDevices = file.Devices ?? [];
            return true;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to load pairing devices file {DevicesFilePath}.", path);
            return false;
        }
    }

    private Dictionary<string, FailedAttemptState> LoadFailedAttempts()
    {
        if (!File.Exists(lockoutsFilePath))
        {
            return new Dictionary<string, FailedAttemptState>();
        }

        try
        {
            var json = File.ReadAllText(lockoutsFilePath);
            var file = JsonSerializer.Deserialize<LockoutsFile>(json)
                ?? throw new JsonException("Pairing lockouts file is empty.");

            return file.Attempts is null
                ? new Dictionary<string, FailedAttemptState>()
                : new Dictionary<string, FailedAttemptState>(file.Attempts);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to load pairing lockouts file {LockoutsFilePath}.", lockoutsFilePath);
            return new Dictionary<string, FailedAttemptState>();
        }
    }

    // Verlorene Lockout-Daten sind unkritisch (sie stellen sich nach LockoutDuration von selbst
    // wieder her), daher genügt ein Best-Effort-Schreibvorgang ohne Rollback der aufrufenden
    // Operation.
    private void TryPersistFailedAttempts()
    {
        try
        {
            var directory = Path.GetDirectoryName(lockoutsFilePath)
                ?? throw new InvalidOperationException("Pairing lockouts file must have a parent directory.");
            Directory.CreateDirectory(directory);

            var json = JsonSerializer.Serialize(
                new LockoutsFile(failedAttemptsByIp),
                new JsonSerializerOptions { WriteIndented = true });
            var temporaryFilePath = Path.Combine(
                directory,
                $".{Path.GetFileName(lockoutsFilePath)}.{Guid.NewGuid():N}.tmp");

            File.WriteAllText(temporaryFilePath, json);
            File.Move(temporaryFilePath, lockoutsFilePath, overwrite: true);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to persist pairing lockouts file {LockoutsFilePath}.", lockoutsFilePath);
        }
    }

    private bool TryPersistDevices()
    {
        try
        {
            PersistDevicesAtomically();
            return true;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to persist pairing devices file {DevicesFilePath}.", devicesFilePath);
            return false;
        }
    }

    private void PersistDevicesAtomically()
    {
        var directory = Path.GetDirectoryName(devicesFilePath)
            ?? throw new InvalidOperationException("Pairing devices file must have a parent directory.");
        Directory.CreateDirectory(directory);

        var json = JsonSerializer.Serialize(
            new DevicesFile(devices),
            new JsonSerializerOptions { WriteIndented = true });
        var temporaryFilePath = Path.Combine(
            directory,
            $".{Path.GetFileName(devicesFilePath)}.{Guid.NewGuid():N}.tmp");
        var replacementBackupPath = Path.Combine(
            directory,
            $".{Path.GetFileName(backupFilePath)}.{Guid.NewGuid():N}.tmp");

        try
        {
            WriteAllTextDurably(temporaryFilePath, json);

            if (File.Exists(devicesFilePath))
            {
                File.Replace(
                    temporaryFilePath,
                    devicesFilePath,
                    replacementBackupPath,
                    ignoreMetadataErrors: true);

                if (primaryFileIsValid)
                {
                    TryPromoteBackupFile(replacementBackupPath);
                }
            }
            else
            {
                File.Move(temporaryFilePath, devicesFilePath);
            }

            primaryFileIsValid = true;
        }
        finally
        {
            TryDeleteTemporaryFile(temporaryFilePath);
            TryDeleteTemporaryFile(replacementBackupPath);
        }
    }

    private void TryPromoteBackupFile(string replacementBackupPath)
    {
        try
        {
            if (File.Exists(backupFilePath))
            {
                File.Replace(
                    replacementBackupPath,
                    backupFilePath,
                    destinationBackupFileName: null,
                    ignoreMetadataErrors: true);
            }
            else
            {
                File.Move(replacementBackupPath, backupFilePath);
            }
        }
        catch (Exception ex)
        {
            // Die neue Hauptdatei ist zu diesem Zeitpunkt bereits atomar gespeichert. Ein
            // älteres, aber valides Backup ist besser als ein fehlgeschlagenes Pairing.
            logger.LogWarning(ex, "Failed to refresh pairing backup file {BackupFilePath}.", backupFilePath);
        }
    }

    private static void WriteAllTextDurably(string path, string contents)
    {
        using var stream = new FileStream(
            path,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            bufferSize: 4096,
            FileOptions.WriteThrough);
        using var writer = new StreamWriter(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

        writer.Write(contents);
        writer.Flush();
        stream.Flush(flushToDisk: true);
    }

    private void TryDeleteTemporaryFile(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to clean up temporary pairing file {TemporaryFilePath}.", path);
        }
    }

    private sealed record PairedDeviceRecord(
        Guid Id,
        string Name,
        string TokenHash,
        DateTimeOffset PairedAtUtc,
        DateTimeOffset LastSeenUtc);

    private sealed record FailedAttemptState(int Count, DateTimeOffset LockedUntilUtc);

    private sealed record DevicesFile(List<PairedDeviceRecord>? Devices);

    private sealed record LockoutsFile(Dictionary<string, FailedAttemptState>? Attempts);
}

public enum PairingRemovalResult
{
    Removed,
    NotFound,
    PersistenceFailed
}
