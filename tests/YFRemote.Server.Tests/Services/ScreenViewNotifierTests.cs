using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class ScreenViewNotifierTests
{
    [TestMethod]
    public void NotifyAudio_AnnouncesOnlyWithoutARunningScreenView()
    {
        var time = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        var notifier = new ScreenViewNotifier(time);
        var announced = new List<string>();
        notifier.AudioStarted += announced.Add;
        var device = Guid.NewGuid();

        notifier.NotifyAudio(device, () => "Handy");
        notifier.NotifyAudio(device, () => "Handy");
        time.Advance(TimeSpan.FromMinutes(2));
        notifier.NotifyFrame(device, () => "Handy");
        notifier.NotifyAudio(device, () => "Handy");

        CollectionAssert.AreEqual(new[] { "Handy" }, announced);
    }

    [TestMethod]
    public void NotifyFrame_AnnouncesOnlyFirstFrameAfterAPause()
    {
        var time = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        var notifier = new ScreenViewNotifier(time);
        var started = new List<string>();
        notifier.Started += started.Add;
        var device = Guid.NewGuid();

        notifier.NotifyFrame(device, () => "Handy");
        time.Advance(TimeSpan.FromSeconds(30));
        notifier.NotifyFrame(device, () => "Handy");
        time.Advance(TimeSpan.FromMinutes(2));
        notifier.NotifyFrame(device, () => "Handy");
        notifier.NotifyFrame(Guid.NewGuid(), () => "Tablet");

        CollectionAssert.AreEqual(new[] { "Handy", "Handy", "Tablet" }, started);
    }

    private sealed class ManualTimeProvider(DateTimeOffset initialTime) : TimeProvider
    {
        private DateTimeOffset utcNow = initialTime;

        public override DateTimeOffset GetUtcNow() => utcNow;

        public void Advance(TimeSpan duration) => utcNow = utcNow.Add(duration);
    }
}
