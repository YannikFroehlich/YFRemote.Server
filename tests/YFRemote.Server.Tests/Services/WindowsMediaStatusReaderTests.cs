using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class WindowsMediaStatusReaderTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 24, 12, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void Timeline_Playing_CountsOnFromLastUpdate()
    {
        var timeline = WindowsMediaStatusReader.Timeline(
            TimeSpan.Zero,
            TimeSpan.FromSeconds(200),
            TimeSpan.FromSeconds(50),
            Now.AddSeconds(-10),
            playing: true,
            Now);

        Assert.AreEqual(((int?)60, (int?)200), timeline);
    }

    [TestMethod]
    public void Timeline_Paused_KeepsReportedPosition()
    {
        var timeline = WindowsMediaStatusReader.Timeline(
            TimeSpan.Zero,
            TimeSpan.FromSeconds(200),
            TimeSpan.FromSeconds(50),
            Now.AddSeconds(-10),
            playing: false,
            Now);

        Assert.AreEqual(((int?)50, (int?)200), timeline);
    }

    [TestMethod]
    public void Timeline_StaleUpdate_StopsAtTheEnd()
    {
        var timeline = WindowsMediaStatusReader.Timeline(
            TimeSpan.Zero,
            TimeSpan.FromSeconds(200),
            TimeSpan.FromSeconds(190),
            Now.AddMinutes(-5),
            playing: true,
            Now);

        Assert.AreEqual(((int?)200, (int?)200), timeline);
    }

    [TestMethod]
    public void Timeline_WithoutLength_IsEmpty()
    {
        var timeline = WindowsMediaStatusReader.Timeline(
            TimeSpan.Zero,
            TimeSpan.Zero,
            TimeSpan.FromSeconds(50),
            Now,
            playing: true,
            Now);

        Assert.AreEqual(((int?)null, (int?)null), timeline);
    }
}
