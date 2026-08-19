using System.Reflection;
using Velopack;
using Velopack.Sources;

namespace YFRemote.Server.Updates;

public sealed class UpdateService
{
    private const string ReleaseRepositoryUrl = "https://github.com/YannikFroehlich/YFRemote.Server";

    private readonly UpdateManager updateManager = new(
        new GithubSource(ReleaseRepositoryUrl, accessToken: null, prerelease: false));

    public bool CanUpdate => updateManager.IsInstalled;

    public string CurrentVersion =>
        updateManager.CurrentVersion?.ToString() ?? GetAssemblyVersion();

    public Task<UpdateInfo?> CheckForUpdatesAsync()
    {
        return updateManager.CheckForUpdatesAsync();
    }

    public Task DownloadUpdatesAsync(UpdateInfo update, Action<int>? progress = null)
    {
        return updateManager.DownloadUpdatesAsync(update, progress);
    }

    public void ApplyAfterExit(UpdateInfo update)
    {
        updateManager.WaitExitThenApplyUpdates(
            update.TargetFullRelease,
            silent: false,
            restart: true);
    }

    private static string GetAssemblyVersion()
    {
        var informationalVersion = Assembly.GetEntryAssembly()?
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;

        if (!string.IsNullOrWhiteSpace(informationalVersion))
        {
            return informationalVersion.Split('+', 2)[0];
        }

        return Assembly.GetEntryAssembly()?.GetName().Version?.ToString(3) ?? "unbekannt";
    }
}
