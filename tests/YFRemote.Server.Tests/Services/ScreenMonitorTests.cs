using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class ScreenMonitorTests
{
    private static readonly ScreenMonitor Left = new("left", -1920, 0, 1920, 1080, false);
    private static readonly ScreenMonitor Main = new("main", 0, 0, 2560, 1440, true);

    [TestMethod]
    public void Resolve_FindsTheChosenMonitor()
    {
        Assert.AreEqual(Left, ScreenMonitor.Resolve([Left, Main], "left"));
    }

    [TestMethod]
    public void Resolve_FallsBackToThePrimaryMonitor()
    {
        Assert.AreEqual(Main, ScreenMonitor.Resolve([Left, Main], null));
        Assert.AreEqual(Main, ScreenMonitor.Resolve([Left, Main], "unplugged"));
    }

    [TestMethod]
    public void Resolve_WithoutMonitors_IsNull()
    {
        Assert.IsNull(ScreenMonitor.Resolve([], null));
    }
}
