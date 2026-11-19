using YFRemote.Server.Configuration;

namespace YFRemote.Server.Tests.Configuration;

[TestClass]
public sealed class ObsOptionsTests
{
    private string directory = null!;

    [TestInitialize]
    public void Initialize()
    {
        directory = Path.Combine(Path.GetTempPath(), "YFRemote.Server.Tests", Guid.NewGuid().ToString("N"));
    }

    [TestCleanup]
    public void Cleanup()
    {
        if (Directory.Exists(directory))
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    [TestMethod]
    public void Resolve_ReadsPortAndPasswordFromObs()
    {
        WriteConfig("""{"server_enabled":true,"server_port":4460,"auth_required":true,"server_password":"geheim"}""");

        var settings = new ObsOptions { ConfigDirectory = directory }.Resolve();

        Assert.AreEqual(new ObsConnectionSettings(true, 4460, "geheim"), settings);
    }

    [TestMethod]
    public void Resolve_IgnoresPasswordWithoutAuthAndReportsDisabledServer()
    {
        WriteConfig("""{"server_enabled":false,"server_port":4455,"auth_required":false,"server_password":"alt"}""");

        var settings = new ObsOptions { ConfigDirectory = directory }.Resolve();

        Assert.AreEqual(new ObsConnectionSettings(false, 4455, null), settings);
    }

    [TestMethod]
    public void Resolve_WithoutConfigFile_TriesDefaultPort()
    {
        var settings = new ObsOptions { ConfigDirectory = directory }.Resolve();

        Assert.AreEqual(new ObsConnectionSettings(true, ObsOptions.DefaultPort, null), settings);
    }

    [TestMethod]
    public void Resolve_SettingsOverrideObs()
    {
        WriteConfig("""{"server_enabled":false,"server_port":4460,"auth_required":true,"server_password":"geheim"}""");

        var settings = new ObsOptions { ConfigDirectory = directory, Port = 5000, Password = "eigenes" }.Resolve();

        Assert.AreEqual(new ObsConnectionSettings(true, 5000, "eigenes"), settings);
    }

    [TestMethod]
    public void Resolve_DamagedConfig_FallsBackToDefaults()
    {
        WriteConfig("""{"server_port":"viele""");

        var settings = new ObsOptions { ConfigDirectory = directory }.Resolve();

        Assert.AreEqual(new ObsConnectionSettings(true, ObsOptions.DefaultPort, null), settings);
    }

    [TestMethod]
    public void Validate_RejectsInvalidPort()
    {
        Assert.ThrowsExactly<InvalidOperationException>(() => new ObsOptions { Port = 0 }.Validate());
    }

    private void WriteConfig(string json)
    {
        var folder = Path.Combine(directory, "plugin_config", "obs-websocket");
        Directory.CreateDirectory(folder);
        File.WriteAllText(Path.Combine(folder, "config.json"), json);
    }
}
