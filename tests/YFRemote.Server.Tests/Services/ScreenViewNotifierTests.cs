using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class ScreenViewNotifierTests
{
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
