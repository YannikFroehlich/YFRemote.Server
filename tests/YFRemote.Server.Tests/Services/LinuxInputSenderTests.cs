using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

// Deckt nur ExecuteSynchronized ab: Das eigentliche Senden legt beim ersten Aufruf ein
// echtes /dev/uinput-Geraet an (siehe LinuxInputSender-Klassenkommentar) und ist ohne
// Linux-Kernel nicht testbar - dafuer siehe AGENTS.md "Linux support" (VM-Verifikation).
[TestClass]
public sealed class LinuxInputSenderTests
{
    [TestMethod]
    public void ExecuteSynchronized_ConcurrentCalls_NeverOverlap()
    {
        var sender = new LinuxInputSender();
        var concurrentEntries = 0;
        var maxObservedConcurrency = 0;
        var maxLock = new object();

        void CriticalSection()
        {
            var current = Interlocked.Increment(ref concurrentEntries);
            lock (maxLock)
            {
                maxObservedConcurrency = Math.Max(maxObservedConcurrency, current);
            }

            Thread.Sleep(20);
            Interlocked.Decrement(ref concurrentEntries);
        }

        Parallel.Invoke(
            () => sender.ExecuteSynchronized(CriticalSection),
            () => sender.ExecuteSynchronized(CriticalSection),
            () => sender.ExecuteSynchronized(CriticalSection),
            () => sender.ExecuteSynchronized(CriticalSection));

        Assert.AreEqual(1, maxObservedConcurrency);
    }

    [TestMethod]
    public void ExecuteSynchronized_ActionThrows_PropagatesException()
    {
        var sender = new LinuxInputSender();

        Assert.ThrowsExactly<InvalidOperationException>(
            () => sender.ExecuteSynchronized(() => throw new InvalidOperationException("boom")));
    }

    [TestMethod]
    public void ExecuteSynchronized_AfterActionThrows_LockIsReleasedForSubsequentCalls()
    {
        var sender = new LinuxInputSender();

        try
        {
            sender.ExecuteSynchronized(() => throw new InvalidOperationException("boom"));
        }
        catch (InvalidOperationException)
        {
        }

        var executed = false;
        sender.ExecuteSynchronized(() => executed = true);

        Assert.IsTrue(executed);
    }
}
