using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class VideoBitrateControlTests
{
    private static TimeSpan Seconds(double seconds) => TimeSpan.FromSeconds(seconds);

    // Eine Sekunde mit `kbps` durch die Leitung, davon `blocked` Sekunden Warten beim Senden.
    private static void Second(VideoBitrateControl control, ref double now, int kbps, double blocked)
    {
        now += 1;
        control.Report(kbps * 1000 / 8, Seconds(blocked), Seconds(now));
    }

    [TestMethod]
    public void Report_StaysAtMaximumWhileSendingNeverWaits()
    {
        var control = new VideoBitrateControl(8000);
        var now = 0.0;

        for (var second = 0; second < 10; second++)
        {
            Second(control, ref now, 8000, 0.01);
        }

        Assert.AreEqual(8000, control.Kbps);
    }

    [TestMethod]
    public void Report_ToleratesShortWaitsLikeAKeyframe()
    {
        var control = new VideoBitrateControl(8000);
        var now = 0.0;

        Second(control, ref now, 8000, 0.2);
        Assert.AreEqual(8000, control.Kbps);

        Second(control, ref now, 5000, 0.3);
        Assert.AreEqual(4000, control.Kbps);
    }

    [TestMethod]
    public void Report_DropsBelowMeasuredThroughputWhenSendingWaits()
    {
        var control = new VideoBitrateControl(8000);
        var now = 0.0;

        Second(control, ref now, 5000, 0.8);

        Assert.AreEqual(4000, control.Kbps);
    }

    [TestMethod]
    public void Report_DropsAtLeastAFewPercentEvenIfThroughputLooksFine()
    {
        var control = new VideoBitrateControl(8000);
        var now = 0.0;

        Second(control, ref now, 9000, 0.8);

        Assert.AreEqual(6800, control.Kbps);
    }

    [TestMethod]
    public void Report_AtMostHalvesPerStepAndKeepsTheFloor()
    {
        var control = new VideoBitrateControl(8000);
        var now = 0.0;

        Second(control, ref now, 100, 0.9);
        Assert.AreEqual(4000, control.Kbps);

        for (var second = 0; second < 5; second++)
        {
            Second(control, ref now, 100, 0.9);
        }

        Assert.AreEqual(1000, control.Kbps);
    }

    [TestMethod]
    public void Report_RaisesOnlyAfterTheHoldAndOnlyWhenTheStreamUsesIt()
    {
        var control = new VideoBitrateControl(8000);
        var now = 0.0;
        Second(control, ref now, 5000, 0.8);
        Assert.AreEqual(4000, control.Kbps);

        for (var second = 0; second < 4; second++)
        {
            Second(control, ref now, 4000, 0);
            Assert.AreEqual(4000, control.Kbps, "noch in der Wartezeit");
        }

        // Ruhiger Bildschirm: kein Anlass, auch nach der Wartezeit.
        for (var second = 0; second < 5; second++)
        {
            Second(control, ref now, 100, 0);
        }

        Assert.AreEqual(4000, control.Kbps);

        Second(control, ref now, 4000, 0);
        Assert.AreEqual(4800, control.Kbps);
        Second(control, ref now, 4800, 0);
        Assert.AreEqual(4800, control.Kbps, "hoechstens alle 2 s");
        Second(control, ref now, 4800, 0);
        Assert.AreEqual(5760, control.Kbps);
    }

    [TestMethod]
    public void Report_NeverRaisesAboveTheMaximum()
    {
        var control = new VideoBitrateControl(8000);
        var now = 0.0;
        Second(control, ref now, 9000, 0.8);

        for (var second = 0; second < 30; second++)
        {
            Second(control, ref now, 8000, 0);
        }

        Assert.AreEqual(8000, control.Kbps);
    }
}
