using YFRemote.Server.Diagnostics;

namespace YFRemote.Server.Tests.Diagnostics;

[TestClass]
public sealed class DiagnosticPathsTests
{
    [TestMethod]
    public void GetLogDirectory_UsesStableLocalAppDataLocation()
    {
        var directory = DiagnosticPaths.GetLogDirectory(@"C:\Users\Test\AppData\Local");

        Assert.AreEqual(@"C:\Users\Test\AppData\Local\YFRemote\Logs", directory);
    }

    [TestMethod]
    public void GetLogDirectory_WithNull_ThrowsArgumentNullException()
    {
        Assert.ThrowsExactly<ArgumentNullException>(() => DiagnosticPaths.GetLogDirectory(null!));
    }

    [TestMethod]
    [DataRow("")]
    [DataRow("   ")]
    public void GetLogDirectory_WithEmptyOrWhitespace_ThrowsArgumentException(string localApplicationData)
    {
        Assert.ThrowsExactly<ArgumentException>(() => DiagnosticPaths.GetLogDirectory(localApplicationData));
    }

    [TestMethod]
    public void LogDirectory_MatchesGetLogDirectoryForRealLocalAppData()
    {
        var expected = DiagnosticPaths.GetLogDirectory(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));

        Assert.AreEqual(expected, DiagnosticPaths.LogDirectory);
    }

    [TestMethod]
    public void RollingLogFilePath_IsFixedFileNameInsideLogDirectory()
    {
        Assert.AreEqual(
            Path.Combine(DiagnosticPaths.LogDirectory, "yfremote-.log"),
            DiagnosticPaths.RollingLogFilePath);
    }

    [TestMethod]
    public void StartupErrorLogFilePath_IsFixedFileNameInsideLogDirectory()
    {
        Assert.AreEqual(
            Path.Combine(DiagnosticPaths.LogDirectory, "startup-error.log"),
            DiagnosticPaths.StartupErrorLogFilePath);
    }

    [TestMethod]
    public void EnsureLogDirectory_CreatesDirectoryAndReturnsItsPath()
    {
        var returnedPath = DiagnosticPaths.EnsureLogDirectory();

        Assert.AreEqual(DiagnosticPaths.LogDirectory, returnedPath);
        Assert.IsTrue(Directory.Exists(returnedPath));
    }
}
