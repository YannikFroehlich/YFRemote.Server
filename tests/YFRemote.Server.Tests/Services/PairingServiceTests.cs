using Microsoft.Extensions.Logging.Abstractions;
using YFRemote.Server.Configuration;
using YFRemote.Server.Models;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class PairingServiceTests
{
    private static readonly DateTimeOffset InitialTime = new(2026, 8, 23, 12, 0, 0, TimeSpan.Zero);

    private string testDirectory = null!;
    private string devicesFilePath = null!;
    private ManualTimeProvider timeProvider = null!;

    [TestInitialize]
    public void Initialize()
    {
        var testRoot = Path.Combine(Path.GetTempPath(), "YFRemote.Server.Tests");
        testDirectory = Path.Combine(testRoot, Guid.NewGuid().ToString("N"));
        devicesFilePath = Path.Combine(testDirectory, "devices.json");
        timeProvider = new ManualTimeProvider(InitialTime);
        Directory.CreateDirectory(testDirectory);
    }

    [TestCleanup]
    public void Cleanup()
    {
        if (!Directory.Exists(testDirectory))
        {
            return;
        }

        var testRoot = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "YFRemote.Server.Tests"))
            + Path.DirectorySeparatorChar;
        var resolvedTestDirectory = Path.GetFullPath(testDirectory) + Path.DirectorySeparatorChar;
        if (!resolvedTestDirectory.StartsWith(testRoot, StringComparison.OrdinalIgnoreCase))
        {
            Assert.Fail($"Unsicheres Testverzeichnis: {resolvedTestDirectory}");
        }

        Directory.Delete(testDirectory, recursive: true);
    }

    [TestMethod]
    public void TryPair_PersistsHashedTokenAndRotatesPinAfterSuccessfulWrite()
    {
        var service = CreateService();
        var originalPin = service.GetCurrentPin();
        timeProvider.Advance(TimeSpan.FromMinutes(1));

        var response = Pair(service, originalPin.Pin, "  Testgerät  ");

        Assert.IsTrue(response.Success, response.Error);
        Assert.IsNotNull(response.Token);
        Assert.IsTrue(File.Exists(devicesFilePath));
        Assert.IsFalse(File.ReadAllText(devicesFilePath).Contains(response.Token, StringComparison.Ordinal));

        var rotatedPin = service.GetCurrentPin();
        Assert.IsGreaterThan(originalPin.ExpiresAtUtc, rotatedPin.ExpiresAtUtc);
        Assert.IsEmpty(Directory.GetFiles(testDirectory, "*.tmp"));

        var reloadedService = CreateService();
        Assert.IsTrue(reloadedService.IsValidToken(response.Token));
        Assert.HasCount(1, reloadedService.GetPairedDevices());
        Assert.AreEqual("Testgerät", reloadedService.GetPairedDevices()[0].Name);
    }

    [TestMethod]
    public void TryPair_WhenWriteFails_RollsBackDeviceAndKeepsPinUsable()
    {
        var pathBlockingDirectory = Path.Combine(testDirectory, "blocker");
        File.WriteAllText(pathBlockingDirectory, "not a directory");
        var blockedDevicesFilePath = Path.Combine(pathBlockingDirectory, "devices.json");
        var service = CreateService(blockedDevicesFilePath);
        var originalPin = service.GetCurrentPin();

        var failedResponse = Pair(service, originalPin.Pin, "Nicht gespeichert");

        Assert.IsFalse(failedResponse.Success);
        Assert.IsNotNull(failedResponse.Error);
        StringAssert.Contains(failedResponse.Error, "dauerhaft gespeichert");
        Assert.IsEmpty(service.GetPairedDevices());
        Assert.AreEqual(originalPin, service.GetCurrentPin());

        File.Delete(pathBlockingDirectory);
        var retryResponse = Pair(service, originalPin.Pin, "Gespeichert");

        Assert.IsTrue(retryResponse.Success, retryResponse.Error);
        Assert.HasCount(1, service.GetPairedDevices());
    }

    [TestMethod]
    public void RemoveDevice_WhenWriteFails_RollsBackAndCanBeRetried()
    {
        var service = CreateService();
        var pairResponse = Pair(service, service.GetCurrentPin().Pin, "Telefon");
        Assert.IsTrue(pairResponse.Success, pairResponse.Error);
        var deviceId = service.GetPairedDevices()[0].Id;

        bool firstRemovalResult;
        using (File.Open(devicesFilePath, FileMode.Open, FileAccess.Read, FileShare.None))
        {
            firstRemovalResult = service.RemoveDevice(deviceId);
        }

        Assert.IsFalse(firstRemovalResult);
        Assert.HasCount(1, service.GetPairedDevices());
        Assert.IsTrue(service.RemoveDevice(deviceId));
        Assert.IsEmpty(service.GetPairedDevices());
        Assert.IsEmpty(CreateService().GetPairedDevices());
    }

    [TestMethod]
    public void RemoveDeviceByToken_RemovesOnlyTheMatchingPersistedDevice()
    {
        var service = CreateService();
        var first = Pair(service, service.GetCurrentPin().Pin, "Telefon");
        var second = Pair(service, service.GetCurrentPin().Pin, "Tablet");
        Assert.IsTrue(first.Success, first.Error);
        Assert.IsTrue(second.Success, second.Error);
        Assert.IsNotNull(first.Token);
        Assert.IsNotNull(second.Token);

        var result = service.RemoveDeviceByToken(first.Token);

        Assert.AreEqual(PairingRemovalResult.Removed, result);
        Assert.IsFalse(service.IsValidToken(first.Token));
        Assert.IsTrue(service.IsValidToken(second.Token));
        Assert.HasCount(1, CreateService().GetPairedDevices());
    }

    [TestMethod]
    public void RemoveDeviceByToken_WithUnknownToken_DoesNotChangeStoredDevices()
    {
        var service = CreateService();
        var pairResponse = Pair(service, service.GetCurrentPin().Pin, "Telefon");
        Assert.IsTrue(pairResponse.Success, pairResponse.Error);

        var result = service.RemoveDeviceByToken("unknown-token");

        Assert.AreEqual(PairingRemovalResult.NotFound, result);
        Assert.HasCount(1, service.GetPairedDevices());
        Assert.HasCount(1, CreateService().GetPairedDevices());
    }

    [TestMethod]
    public void RemoveDeviceByToken_WhenWriteFails_KeepsTheTokenValidForRetry()
    {
        var service = CreateService();
        var pairResponse = Pair(service, service.GetCurrentPin().Pin, "Telefon");
        Assert.IsTrue(pairResponse.Success, pairResponse.Error);
        Assert.IsNotNull(pairResponse.Token);

        PairingRemovalResult firstResult;
        using (File.Open(devicesFilePath, FileMode.Open, FileAccess.Read, FileShare.None))
        {
            firstResult = service.RemoveDeviceByToken(pairResponse.Token);
        }

        Assert.AreEqual(PairingRemovalResult.PersistenceFailed, firstResult);
        Assert.IsTrue(service.IsValidToken(pairResponse.Token));
        Assert.AreEqual(
            PairingRemovalResult.Removed,
            service.RemoveDeviceByToken(pairResponse.Token));
        Assert.IsFalse(service.IsValidToken(pairResponse.Token));
    }

    [TestMethod]
    public void LoadDevices_WhenPrimaryIsDamaged_RecoversAndPreservesValidBackup()
    {
        var service = CreateService();
        Assert.IsTrue(Pair(service, service.GetCurrentPin().Pin, "Erstes Gerät").Success);
        Assert.IsTrue(Pair(service, service.GetCurrentPin().Pin, "Zweites Gerät").Success);
        Assert.IsTrue(File.Exists($"{devicesFilePath}.bak"));

        File.WriteAllText(devicesFilePath, "{ damaged json");
        var recoveredService = CreateService();
        var recoveredDevices = recoveredService.GetPairedDevices();

        Assert.HasCount(1, recoveredDevices);
        Assert.AreEqual("Erstes Gerät", recoveredDevices[0].Name);
        Assert.IsTrue(Pair(
            recoveredService,
            recoveredService.GetCurrentPin().Pin,
            "Nach Wiederherstellung").Success);

        File.WriteAllText(devicesFilePath, "{ damaged again");
        var recoveredAgainDevices = CreateService().GetPairedDevices();

        Assert.HasCount(1, recoveredAgainDevices);
        Assert.AreEqual("Erstes Gerät", recoveredAgainDevices[0].Name);
        Assert.IsEmpty(Directory.GetFiles(testDirectory, "*.tmp"));
    }

    [TestMethod]
    public void IsValidToken_PersistsLastSeenOnlyAfterConfiguredInterval()
    {
        var service = CreateService(lastSeenPersistenceInterval: TimeSpan.FromMinutes(5));
        var pairResponse = Pair(service, service.GetCurrentPin().Pin, "Tablet");
        Assert.IsTrue(pairResponse.Success, pairResponse.Error);
        Assert.IsNotNull(pairResponse.Token);
        var pairedAt = service.GetPairedDevices()[0].LastSeenUtc;

        timeProvider.Advance(TimeSpan.FromMinutes(1));
        Assert.IsTrue(service.IsValidToken(pairResponse.Token));
        Assert.AreEqual(timeProvider.GetUtcNow(), service.GetPairedDevices()[0].LastSeenUtc);
        Assert.AreEqual(pairedAt, CreateService().GetPairedDevices()[0].LastSeenUtc);

        timeProvider.Advance(TimeSpan.FromMinutes(5));
        Assert.IsTrue(service.IsValidToken(pairResponse.Token));
        Assert.AreEqual(timeProvider.GetUtcNow(), CreateService().GetPairedDevices()[0].LastSeenUtc);
    }

    [TestMethod]
    public void TryPair_AfterFiveInvalidPins_LocksClientUntilTimeoutExpires()
    {
        var service = CreateService();
        var validPin = service.GetCurrentPin().Pin;
        var invalidPin = validPin == "000000" ? "000001" : "000000";

        for (var attempt = 0; attempt < 5; attempt++)
        {
            var response = Pair(service, invalidPin, clientIp: "192.0.2.10");
            Assert.IsFalse(response.Success);
            Assert.AreEqual("PIN ungültig.", response.Error);
        }

        var lockedResponse = Pair(service, validPin, clientIp: "192.0.2.10");
        Assert.IsFalse(lockedResponse.Success);
        Assert.IsNotNull(lockedResponse.Error);
        StringAssert.Contains(lockedResponse.Error, "Zu viele Fehlversuche");

        timeProvider.Advance(TimeSpan.FromSeconds(60));
        var responseAfterTimeout = Pair(service, validPin, clientIp: "192.0.2.10");
        Assert.IsTrue(responseAfterTimeout.Success, responseAfterTimeout.Error);
    }

    private PairingService CreateService(
        string? path = null,
        TimeSpan? lastSeenPersistenceInterval = null)
    {
        var options = new PairingStorageOptions
        {
            DevicesFilePath = path ?? devicesFilePath,
            PinLifetime = TimeSpan.FromMinutes(10),
            LockoutDuration = TimeSpan.FromSeconds(60),
            LastSeenPersistenceInterval = lastSeenPersistenceInterval ?? TimeSpan.FromMinutes(5)
        };

        return new PairingService(NullLogger<PairingService>.Instance, options, timeProvider);
    }

    private static PairResponse Pair(
        PairingService service,
        string pin,
        string deviceName = "Testgerät",
        string clientIp = "127.0.0.1")
    {
        return service.TryPair(
            new PairRequest
            {
                Pin = pin,
                DeviceName = deviceName
            },
            clientIp);
    }

    private sealed class ManualTimeProvider(DateTimeOffset initialTime) : TimeProvider
    {
        private DateTimeOffset utcNow = initialTime;

        public override DateTimeOffset GetUtcNow()
        {
            return utcNow;
        }

        public void Advance(TimeSpan duration)
        {
            utcNow = utcNow.Add(duration);
        }
    }
}
