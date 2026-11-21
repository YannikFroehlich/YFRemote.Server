using YFRemote.Server.Models;
using YFRemote.Server.Services;
using YFRemote.Server.Tests.Integration;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class ClipboardPollTests
{
    [TestMethod]
    public async Task Poll_ReadsContentOnlyAfterTheChangeCountMoved()
    {
        var clipboard = new FakeClipboardService { ChangeCount = 1, TextToReturn = "eins" };
        var poll = ClipboardPoll.Create(clipboard, maxTextLength: 10);

        Assert.AreEqual(new ClipboardMessage("eins"), await poll());
        clipboard.TextToReturn = "zwei";
        Assert.AreEqual(new ClipboardMessage("eins"), await poll());
        clipboard.ChangeCount = 2;
        Assert.AreEqual(new ClipboardMessage("zwei"), await poll());

        Assert.AreEqual(2, clipboard.TextReads);
    }

    [TestMethod]
    public async Task Poll_WithoutChangeCount_ReadsEveryTime()
    {
        var clipboard = new FakeClipboardService { TextToReturn = "viel zu langer Text", ImageIdToReturn = "7" };
        var poll = ClipboardPoll.Create(clipboard, maxTextLength: 10);

        Assert.IsNull(await poll());
        clipboard.TextToReturn = null;
        Assert.AreEqual(new ClipboardMessage(null, "7"), await poll());

        Assert.AreEqual(2, clipboard.TextReads);
    }
}
