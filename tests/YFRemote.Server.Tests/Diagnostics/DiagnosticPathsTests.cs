using YFRemote.Server.Diagnostics;

namespace YFRemote.Server.Tests.Diagnostics;

[TestClass]
public sealed class DiagnosticPathsTests
{
    [TestMethod]
    public void GetLogDirectory_UsesStableLocalAppDataLocation()
    {
        // Path.Combine statt eines hartcodierten Windows-Pfads: GetLogDirectory haengt nur
        // "YFRemote"/"Logs" an, das Trennzeichen selbst ist plattformabhaengig (\ unter
        // Windows, / unter Linux) und kein Teil des zu testenden Verhaltens.
        var localApplicationData = Path.Combine("base", "Users", "Test", "AppData", "Local");

        var directory = DiagnosticPaths.GetLogDirectory(localApplicationData);

        Assert.AreEqual(Path.Combine(localApplicationData, "YFRemote", "Logs"), directory);
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
