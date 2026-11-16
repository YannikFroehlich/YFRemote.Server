#if WINDOWS
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public class WindowsExplorerSendMenuTests
{
    [TestMethod]
    public void OfferArgument_IsReadAndRemoved()
    {
        string[] args = ["Server:Port=5060", "--offer-file", @"C:\Daten\Bericht.pdf", "--wait-for-previous-instance"];

        Assert.AreEqual(@"C:\Daten\Bericht.pdf", WindowsExplorerSendMenu.GetOfferPath(args));
        CollectionAssert.AreEqual(
            new[] { "Server:Port=5060", "--wait-for-previous-instance" },
            WindowsExplorerSendMenu.WithoutOfferArgument(args));
        Assert.IsNull(WindowsExplorerSendMenu.GetOfferPath(["--offer-file"]));
        Assert.IsEmpty(WindowsExplorerSendMenu.WithoutOfferArgument(["--offer-file"]));
    }

    [TestMethod]
    public async Task Pipe_HandsThePathToTheRunningInstance()
    {
        using var stop = new CancellationTokenSource();
        var received = new TaskCompletionSource<string>();
        var listener = WindowsExplorerSendMenu.ListenAsync(path => received.TrySetResult(path), stop.Token);

        var sent = await Task.Run(() => WindowsExplorerSendMenu.TrySendToRunningInstance(@"C:\Daten\Urlaub äöü.jpg"));

        Assert.IsTrue(sent);
        Assert.AreEqual(@"C:\Daten\Urlaub äöü.jpg", await received.Task.WaitAsync(TimeSpan.FromSeconds(5)));
        stop.Cancel();
        await listener;
    }
}
#endif
