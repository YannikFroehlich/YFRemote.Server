using Velopack.Locators;
using YFRemote.Server.Updates;

namespace YFRemote.Server.Tests.Updates;

// CheckForUpdatesAsync/DownloadUpdatesAsync/ApplyAfterExit greifen auf echte GitHub-Releases
// bzw. den Prozess-Neustart zu und werden deshalb hier nicht getestet - nur die synchronen,
// lokal auswertbaren Eigenschaften. Ein TestVelopackLocator wird immer explizit übergeben,
// damit die Tests nicht vom globalen, prozessweiten VelopackLocator.Current abhängen.
[TestClass]
public sealed class UpdateServiceTests
{
    [TestMethod]
    public void CanUpdate_WithInstalledLocator_ReturnsTrue()
    {
        var updateService = new UpdateService(CreateTestLocator("1.2.3"));

        Assert.IsTrue(updateService.CanUpdate);
    }

    [TestMethod]
    public void CurrentVersion_WithInstalledLocator_ReturnsConfiguredVersion()
    {
        var updateService = new UpdateService(CreateTestLocator("1.2.3"));

        Assert.AreEqual("1.2.3", updateService.CurrentVersion);
    }

    private static TestVelopackLocator CreateTestLocator(string version) =>
        new(appId: "YFRemote.Server.Tests", version: version, packagesDir: Path.GetTempPath());
}
