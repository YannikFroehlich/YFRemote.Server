using System.Text.Json;
using YFRemote.Server.Configuration;

namespace YFRemote.Server.Tests.Configuration;

[TestClass]
public sealed class UserSettingsStoreTests
{
    private string directoryPath = string.Empty;
    private string filePath = string.Empty;

    [TestInitialize]
    public void CreateTemporaryDirectory()
    {
        directoryPath = Path.Combine(Path.GetTempPath(), $"yfremote-settings-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directoryPath);
        filePath = Path.Combine(directoryPath, "settings.json");
    }

    [TestCleanup]
    public void RemoveTemporaryDirectory()
    {
        if (Directory.Exists(directoryPath))
        {
            Directory.Delete(directoryPath, recursive: true);
        }
    }

    [TestMethod]
    public void FilePath_IsNextToTheOtherStateFiles()
    {
        var path = UserSettingsStore.GetFilePath(Path.Combine("C:", "state"));

        Assert.AreEqual(Path.Combine("C:", "state", "YFRemote", "settings.json"), path);
    }

    [TestMethod]
    public void SetHttpsEnabled_WithoutExistingFile_WritesTheSection()
    {
        UserSettingsStore.SetHttpsEnabled(filePath, enabled: true);

        Assert.IsTrue(ReadHttpsEnabled());
    }

    [TestMethod]
    public void SetHttpsEnabled_CalledAgain_OverwritesThePreviousValue()
    {
        UserSettingsStore.SetHttpsEnabled(filePath, enabled: true);
        UserSettingsStore.SetHttpsEnabled(filePath, enabled: false);

        Assert.IsFalse(ReadHttpsEnabled());
    }

    [TestMethod]
    public void SetHttpsEnabled_KeepsUnrelatedEntries()
    {
        File.WriteAllText(filePath, """{"Server":{"Port":6060},"Https":{"Port":7443}}""");

        UserSettingsStore.SetHttpsEnabled(filePath, enabled: true);

        using var document = JsonDocument.Parse(File.ReadAllText(filePath));
        var root = document.RootElement;

        Assert.AreEqual(6060, root.GetProperty("Server").GetProperty("Port").GetInt32());
        Assert.AreEqual(7443, root.GetProperty("Https").GetProperty("Port").GetInt32());
        Assert.IsTrue(root.GetProperty("Https").GetProperty("Enabled").GetBoolean());
    }

    [TestMethod]
    public void SetHttpsEnabled_WithDamagedFile_StartsOver()
    {
        File.WriteAllText(filePath, "{ not json");

        UserSettingsStore.SetHttpsEnabled(filePath, enabled: true);

        Assert.IsTrue(ReadHttpsEnabled());
    }

    [TestMethod]
    public void SetHttpsEnabled_LeavesNoTemporaryFileBehind()
    {
        UserSettingsStore.SetHttpsEnabled(filePath, enabled: true);

        Assert.AreEqual(1, Directory.GetFiles(directoryPath).Length);
    }

    private bool ReadHttpsEnabled()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(filePath));
        return document.RootElement.GetProperty("Https").GetProperty("Enabled").GetBoolean();
    }
}
