using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class ProcessServiceTests
{
    [TestMethod]
    public void CpuPercent_CountsAllCoresLikeTaskManager()
    {
        // Ein voll ausgelasteter Kern von vieren ist 25 %.
        Assert.AreEqual(25.0, ProcessService.CpuPercent(TimeSpan.FromMilliseconds(500), TimeSpan.FromMilliseconds(500), 4));
        Assert.AreEqual(100.0, ProcessService.CpuPercent(TimeSpan.FromSeconds(9), TimeSpan.FromSeconds(1), 4));
        Assert.AreEqual(0.0, ProcessService.CpuPercent(TimeSpan.FromSeconds(1), TimeSpan.Zero, 4));
        // Unter 1 % bleibt eine Nachkommastelle stehen: 60 ms auf 12 Kernen in einer Sekunde sind 0,5 %.
        Assert.AreEqual(0.5, ProcessService.CpuPercent(TimeSpan.FromMilliseconds(60), TimeSpan.FromSeconds(1), 12));
    }

    [TestMethod]
    public async Task ListAsync_LeavesOutTheServerItselfAndTryKillRefusesIt()
    {
        var service = new ProcessService();

        var processes = await service.ListAsync(CancellationToken.None);

        Assert.IsTrue(processes.Count is > 0 and <= 15);
        Assert.IsFalse(processes.Any(process => process.Id == Environment.ProcessId));
        Assert.IsFalse(service.TryKill(Environment.ProcessId, Environment.ProcessPath ?? ""));
        // Richtige Nummer, falscher Name: nichts wird beendet.
        Assert.IsFalse(service.TryKill(processes[0].Id, processes[0].Name + "-anders"));
    }

    [TestMethod]
    public void Kbps_IsKilobitPerSecondAndNeverNegative()
    {
        Assert.AreEqual(8000, SystemExtrasReader.Kbps(1_000_000, TimeSpan.FromSeconds(1)));
        Assert.AreEqual(4000, SystemExtrasReader.Kbps(1_000_000, TimeSpan.FromSeconds(2)));
        Assert.AreEqual(0, SystemExtrasReader.Kbps(-5, TimeSpan.FromSeconds(1)));
    }

    [TestMethod]
    public async Task Wrap_AddsDrivesAndGivesNetworkRatesFromTheSecondReading()
    {
        var read = new SystemExtrasReader().Wrap(
            () => Task.FromResult(new YFRemote.Server.Models.SystemStatsMessage(1, null, null, null, 10, 20)));

        var first = await read();
        var second = await read();

        Assert.AreEqual(1, first.CpuLoad);
        Assert.IsNotNull(first.Drives);
        Assert.IsNull(first.NetDownKbps);
        Assert.IsNotNull(second.NetDownKbps);
        Assert.IsNotNull(second.NetUpKbps);
    }
}
