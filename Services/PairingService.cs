using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

public sealed class PairingService(ILogger<PairingService> logger)
{
    private const int PinLength = 6;
    private const int MaxFailedAttempts = 5;
    private const int MaxDeviceNameLength = 60;
    private const string DefaultDeviceName = "Unbekanntes Gerät";

    private static readonly TimeSpan PinLifetime = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan LockoutDuration = TimeSpan.FromSeconds(60);

    private static readonly string DevicesFilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "YFRemote",
        "devices.json");

    private readonly object syncRoot = new();
    private readonly List<PairedDeviceRecord> devices = LoadDevices(logger);
    private readonly Dictionary<string, FailedAttemptState> failedAttemptsByIp = new();

    private (string Pin, DateTimeOffset ExpiresAtUtc) pinState = GenerateNewPin();

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
            pinState = GenerateNewPin();
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
            if (TryGetLockout(clientIp, out var lockedUntilUtc))
            {
                var secondsRemaining =
                    Math.Max(1, (int)Math.Ceiling((lockedUntilUtc - DateTimeOffset.UtcNow).TotalSeconds));
                return PairResponse.Fail($"Zu viele Fehlversuche. Erneut versuchen in {secondsRemaining}s.");
            }

            EnsurePinValid();

            if (!string.Equals(pin, pinState.Pin, StringComparison.Ordinal))
            {
                RegisterFailedAttempt(clientIp);
                return PairResponse.Fail("PIN ungültig.");
            }

            failedAttemptsByIp.Remove(clientIp);

            var token = GenerateDeviceToken();
            var deviceName = NormalizeDeviceName(request!.DeviceName);
            var now = DateTimeOffset.UtcNow;

            devices.Add(new PairedDeviceRecord(Guid.NewGuid(), deviceName, HashToken(token), now, now));
            PersistDevices();

            logger.LogInformation("Device paired: {DeviceName} from {ClientIp}", deviceName, clientIp);

            return PairResponse.Ok(token);
        }
    }

    public bool IsValidToken(string? token)
    {
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

            devices[index] = devices[index] with { LastSeenUtc = DateTimeOffset.UtcNow };
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
            var removed = devices.RemoveAll(device => device.Id == deviceId) > 0;
            if (removed)
            {
                PersistDevices();
            }

            return removed;
        }
    }

    private void EnsurePinValid()
    {
        if (DateTimeOffset.UtcNow >= pinState.ExpiresAtUtc)
        {
            pinState = GenerateNewPin();
        }
    }

    private bool TryGetLockout(string clientIp, out DateTimeOffset lockedUntilUtc)
    {
        if (failedAttemptsByIp.TryGetValue(clientIp, out var state)
            && state.Count >= MaxFailedAttempts
            && DateTimeOffset.UtcNow < state.LockedUntilUtc)
        {
            lockedUntilUtc = state.LockedUntilUtc;
            return true;
        }

        lockedUntilUtc = default;
        return false;
    }

    private void RegisterFailedAttempt(string clientIp)
    {
        var previousCount = failedAttemptsByIp.TryGetValue(clientIp, out var state) ? state.Count : 0;
        var newCount = previousCount + 1;
        var lockedUntilUtc = newCount >= MaxFailedAttempts
            ? DateTimeOffset.UtcNow.Add(LockoutDuration)
            : DateTimeOffset.MinValue;

        failedAttemptsByIp[clientIp] = new FailedAttemptState(newCount, lockedUntilUtc);
    }

    private static (string Pin, DateTimeOffset ExpiresAtUtc) GenerateNewPin()
    {
        var pin = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        return (pin, DateTimeOffset.UtcNow.Add(PinLifetime));
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

    private static List<PairedDeviceRecord> LoadDevices(ILogger<PairingService> logger)
    {
        try
        {
            if (!File.Exists(DevicesFilePath))
            {
                return [];
            }

            var json = File.ReadAllText(DevicesFilePath);
            var file = JsonSerializer.Deserialize<DevicesFile>(json);
            return file?.Devices ?? [];
        }
        catch (Exception ex)
        {
            // Eine beschädigte oder unlesbare Datei darf den Serverstart nicht verhindern:
            // ohne bekannte Geräte startet die Kopplung einfach wieder bei null.
            logger.LogWarning(ex, "Failed to load devices.json; starting with an empty device list.");
            return [];
        }
    }

    private void PersistDevices()
    {
        try
        {
            var directory = Path.GetDirectoryName(DevicesFilePath);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            var json = JsonSerializer.Serialize(
                new DevicesFile(devices),
                new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(DevicesFilePath, json);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to persist devices.json.");
        }
    }

    private sealed record PairedDeviceRecord(
        Guid Id,
        string Name,
        string TokenHash,
        DateTimeOffset PairedAtUtc,
        DateTimeOffset LastSeenUtc);

    private sealed record FailedAttemptState(int Count, DateTimeOffset LockedUntilUtc);

    private sealed record DevicesFile(List<PairedDeviceRecord> Devices);
}
