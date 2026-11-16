#if WINDOWS
using System.IO.Pipes;
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
        var pipeName = NewPipeName();
        var listener = WindowsExplorerSendMenu.ListenAsync(path => received.TrySetResult(path), stop.Token, pipeName);

        var sent = await Task.Run(() => WindowsExplorerSendMenu.TrySendToRunningInstance(@"C:\Daten\Urlaub äöü.jpg", pipeName));

        Assert.IsTrue(sent);
        Assert.AreEqual(@"C:\Daten\Urlaub äöü.jpg", await received.Task.WaitAsync(TimeSpan.FromSeconds(5)));
        stop.Cancel();
        await listener;
    }

    [TestMethod]
    public async Task Listen_WithBusyPipe_ReturnsInsteadOfSpinning()
    {
        var pipeName = NewPipeName();
        await using var occupant = new NamedPipeServerStream(
            pipeName,
            PipeDirection.In,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        using var stop = new CancellationTokenSource();

        // StartNew statt Task.Run: Task.Run wuerde den inneren Task auspacken.
        var call = Task.Factory.StartNew(() => WindowsExplorerSendMenu.ListenAsync(_ => { }, stop.Token, pipeName));
        var finished = await Task.WhenAny(call, Task.Delay(TimeSpan.FromSeconds(5)));
        stop.Cancel();

        Assert.AreSame(call, finished, "ListenAsync kreist bei belegter Pipe synchron.");
        await await call;
    }

    private static string NewPipeName() => $"YFRemote.Server.Tests.{Guid.NewGuid():N}";
}
#endif
