using System.Text.Json.Nodes;
using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

public interface IObsService
{
    // Der Konfigurationsordner von OBS existiert (oder Obs:Port ist gesetzt); laufen muss OBS nicht.
    bool IsInstalled { get; }

    Task<ObsMessage> ReadAsync();

    // Eine obs-websocket-Anfrage wie "SetCurrentProgramScene". NotSupportedException, wenn OBS nicht
    // erreichbar ist oder die Anfrage ablehnt. Welche Anfragen erlaubt sind, entscheidet der Aufrufer.
    Task SendAsync(string requestType, JsonObject? requestData = null);
}
