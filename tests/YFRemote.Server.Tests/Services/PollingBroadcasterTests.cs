using Microsoft.Extensions.Logging.Abstractions;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class PollingBroadcasterTests
{
    [TestMethod]
    public async Task WithoutAnnounceCurrent_OnlyChangesAfterTheFirstPollAreDelivered()
    {
        var value = "alt";
        var broadcaster = Create(() => value, announceCurrent: false);
        var received = new List<string>();
        using var subscription = broadcaster.Subscribe(received.Add);

        await broadcaster.PollAsync();
        await broadcaster.PollAsync();
        value = "neu";
        await broadcaster.PollAsync();
        await broadcaster.PollAsync();

        CollectionAssert.AreEqual(new[] { "neu" }, received);
    }

    [TestMethod]
    public async Task WithAnnounceCurrent_FirstPollAndLateSubscribersGetTheCurrentValue()
    {
        var broadcaster = Create(() => "jetzt", announceCurrent: true);
        var first = new List<string>();
        var late = new List<string>();
        using var firstSubscription = broadcaster.Subscribe(first.Add);

        await broadcaster.PollAsync();
        using var lateSubscription = broadcaster.Subscribe(late.Add);

        CollectionAssert.AreEqual(new[] { "jetzt" }, first);
        CollectionAssert.AreEqual(new[] { "jetzt" }, late);
    }

    [TestMethod]
    public async Task AfterTheLastUnsubscribe_NothingIsDeliveredAndTheBaselineStartsOver()
    {
        var value = "a";
        var broadcaster = Create(() => value, announceCurrent: false);
        var received = new List<string>();

        var subscription = broadcaster.Subscribe(received.Add);
        await broadcaster.PollAsync();
        subscription.Dispose();
        value = "b";
        await broadcaster.PollAsync();

        using var again = broadcaster.Subscribe(received.Add);
        await broadcaster.PollAsync();

        Assert.IsEmpty(received);
    }

    [TestMethod]
    public async Task FailingPoll_IsSwallowedAndKeepsTheLastValue()
    {
        var fail = false;
        var broadcaster = new PollingBroadcaster<string>(
            () => fail ? throw new InvalidOperationException() : Task.FromResult("x"),
            Timeout.InfiniteTimeSpan,
            announceCurrent: false,
            NullLogger.Instance);
        var received = new List<string>();
        using var subscription = broadcaster.Subscribe(received.Add);

        await broadcaster.PollAsync();
        fail = true;
        await broadcaster.PollAsync();
        fail = false;
        await broadcaster.PollAsync();

        Assert.IsEmpty(received);
    }

    private static PollingBroadcaster<string> Create(Func<string> read, bool announceCurrent) =>
        new(() => Task.FromResult(read()), Timeout.InfiniteTimeSpan, announceCurrent, NullLogger.Instance);
}
