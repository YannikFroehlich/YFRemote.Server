using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Lautstaerke pro App und Wahl des Wiedergabegeraets, umgesetzt von den Media-Status-Readern.
public interface IAppVolumeService
{
    Task<AppVolumesMessage> ReadAppsAsync();

    // NotSupportedException, wenn die App inzwischen keinen Ton mehr ausgibt.
    void SetApp(string id, int? volume, bool? muted);

    // id stammt aus AppVolumesMessage.Outputs; der Aufrufer prueft das.
    void SetOutput(string id);
}
