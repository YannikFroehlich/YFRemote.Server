using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

// Deckt nur das Auswerten von /proc ab: hwmon und gpu_busy_percent haengen an echter Hardware.
[TestClass]
public sealed class LinuxSystemStatsReaderTests
{
    [TestMethod]
    public void ParseCpuTimes_CountsIowaitAsIdleAndIgnoresGuest()
    {
        var (idle, total) = LinuxSystemStatsReader.ParseCpuTimes(
            "cpu  100 5 50 800 20 3 2 0 40 0\ncpu0 50 2 25 400 10 1 1 0 20 0\n");

        Assert.AreEqual(820, idle);
        Assert.AreEqual(980, total);
    }

    [TestMethod]
    public void ParseMemInfo_UsesMemAvailable()
    {
        var (usedMb, totalMb) = LinuxSystemStatsReader.ParseMemInfo(
            "MemTotal:       16384000 kB\nMemFree:         1024000 kB\nMemAvailable:    8192000 kB\n");

        Assert.AreEqual(8000, usedMb);
        Assert.AreEqual(16000, totalMb);
    }
}
