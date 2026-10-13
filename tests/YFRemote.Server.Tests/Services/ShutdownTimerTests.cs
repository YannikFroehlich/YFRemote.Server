using Microsoft.Extensions.Logging.Abstractions;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class ShutdownTimerTests
{
    [TestMethod]
    public async Task Schedule_ShutsDownWhenDue()
    {
        var powerService = new CountingPowerService();
        using var shutdownTimer = new ShutdownTimer(powerService, NullLogger<ShutdownTimer>.Instance);
        string? changedBy = null;
        shutdownTimer.Changed += deviceName => changedBy = deviceName;

        shutdownTimer.Schedule(TimeSpan.FromMilliseconds(50), "Handy");

        Assert.AreEqual("Handy", changedBy);
        for (var i = 0; i < 100 && powerService.Shutdowns == 0; i++)
        {
            await Task.Delay(50);
        }

        Assert.AreEqual(1, powerService.Shutdowns);
        Assert.IsNull(shutdownTimer.DueAt);
    }

    [TestMethod]
    public async Task Reschedule_ReplacesEarlierTimer()
    {
        var powerService = new CountingPowerService();
        using var shutdownTimer = new ShutdownTimer(powerService, NullLogger<ShutdownTimer>.Instance);

        shutdownTimer.Schedule(TimeSpan.FromMilliseconds(50), "Handy");
        shutdownTimer.Schedule(TimeSpan.FromMinutes(10), "Handy");
        await Task.Delay(300);

        Assert.AreEqual(0, powerService.Shutdowns);
        Assert.IsNotNull(shutdownTimer.DueAt);
    }

    [TestMethod]
    public async Task Cancel_PreventsShutdown()
    {
        var powerService = new CountingPowerService();
        using var shutdownTimer = new ShutdownTimer(powerService, NullLogger<ShutdownTimer>.Instance);

        shutdownTimer.Schedule(TimeSpan.FromMilliseconds(100), "Handy");
        shutdownTimer.Cancel(deviceName: null);
        await Task.Delay(300);

        Assert.AreEqual(0, powerService.Shutdowns);
        Assert.IsNull(shutdownTimer.DueAt);
    }

    private sealed class CountingPowerService : IPowerService
    {
        private int shutdowns;

        public int Shutdowns => Volatile.Read(ref shutdowns);

        public void Shutdown() => Interlocked.Increment(ref shutdowns);

        public void Restart() { }

        public void Sleep() { }

        public void Lock() { }

        public void TurnOffDisplay() { }
    }
}
