using Serilog;
using YFRemote.Server.Diagnostics;

namespace YFRemote.Server.Tests.Diagnostics;

[TestClass]
public sealed class DiagnosticLoggingTests
{
    private string testDirectory = null!;

    [TestInitialize]
    public void Initialize()
    {
        var testRoot = Path.Combine(Path.GetTempPath(), "YFRemote.Server.Tests");
        testDirectory = Path.Combine(testRoot, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(testDirectory);
    }

    [TestCleanup]
    public void Cleanup()
    {
        if (!Directory.Exists(testDirectory))
        {
            return;
        }

        var testRoot = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "YFRemote.Server.Tests"))
            + Path.DirectorySeparatorChar;
        var resolvedTestDirectory = Path.GetFullPath(testDirectory) + Path.DirectorySeparatorChar;
        if (!resolvedTestDirectory.StartsWith(testRoot, StringComparison.OrdinalIgnoreCase))
        {
            Assert.Fail($"Unsicheres Testverzeichnis: {resolvedTestDirectory}");
        }

        Directory.Delete(testDirectory, recursive: true);
    }

    [TestMethod]
    public void GetLogDirectory_UsesStableLocalAppDataLocation()
    {
        var directory = DiagnosticPaths.GetLogDirectory(@"C:\Users\Test\AppData\Local");

        Assert.AreEqual(@"C:\Users\Test\AppData\Local\YFRemote\Logs", directory);
    }

    [TestMethod]
    public void ConfigureFileLogger_WritesPersistentLogEvent()
    {
        var logFilePath = Path.Combine(testDirectory, "yfremote-.log");
        using (var logger = DiagnosticLogging
            .ConfigureFileLogger(new LoggerConfiguration(), logFilePath)
            .CreateLogger())
        {
            logger.Information("Diagnostic test event {Value}", 42);
        }

        var logFiles = Directory.GetFiles(testDirectory, "yfremote-*.log");
        Assert.HasCount(1, logFiles);
        StringAssert.Contains(File.ReadAllText(logFiles[0]), "Diagnostic test event 42");
    }
}
