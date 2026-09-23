using Microsoft.Extensions.Configuration;
using YFRemote.Server;
using YFRemote.Server.Configuration;

namespace YFRemote.Server.Tests.Configuration;

/// <summary>
/// Reihenfolge der Konfigurationsquellen rund um die im Infobereich gespeicherte Einstellung.
/// </summary>
[TestClass]
public sealed class UserSettingsConfigurationTests
{
    private string directoryPath = string.Empty;
    private string filePath = string.Empty;

    [TestInitialize]
    public void CreateTemporaryDirectory()
    {
        directoryPath = Path.Combine(Path.GetTempPath(), $"yfremote-config-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directoryPath);
        filePath = Path.Combine(directoryPath, "settings.json");
        UserSettingsStore.SetHttpsEnabled(filePath, enabled: true);
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
    public void UserSettings_BeatAppSettings()
    {
        var configuration = Build(
            builder => builder.AddInMemoryCollection(
                new Dictionary<string, string?> { ["Https:Enabled"] = "false" }));

        Assert.IsTrue(ReadHttpsEnabled(configuration));
    }

    [TestMethod]
    public void CommandLineArguments_BeatUserSettings()
    {
        var configuration = Build(
            builder => builder.AddCommandLine(["Https:Enabled=false"]));

        Assert.IsFalse(ReadHttpsEnabled(configuration));
    }

    [TestMethod]
    public void MissingUserSettingsFile_LeavesTheOtherSourcesAlone()
    {
        File.Delete(filePath);

        var configuration = Build(
            builder => builder.AddInMemoryCollection(
                new Dictionary<string, string?> { ["Https:Enabled"] = "true" }));

        Assert.IsTrue(ReadHttpsEnabled(configuration));
    }

    private IConfigurationRoot Build(Action<IConfigurationBuilder> addEarlierSources)
    {
        var builder = new ConfigurationBuilder();
        addEarlierSources(builder);
        Program.AddUserSettings(builder, filePath);
        return builder.Build();
    }

    private static bool ReadHttpsEnabled(IConfiguration configuration)
    {
        var options = configuration.GetSection(HttpsOptions.SectionName).Get<HttpsOptions>()
            ?? new HttpsOptions();

        return options.Enabled;
    }
}
