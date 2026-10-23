using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Lautstaerke pro App, umgesetzt von den Media-Status-Readern.
public interface IAppVolumeService
{
    Task<AppVolumesMessage> ReadAppsAsync();

    // NotSupportedException, wenn die App inzwischen keinen Ton mehr ausgibt.
    void SetApp(string id, int? volume, bool? muted);
}
