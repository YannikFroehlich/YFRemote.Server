namespace YFRemote.Server.Models;

// Wie FileOfferMessage eine ungefragte Server-Nachricht. Restzeit statt Uhrzeit, weil die Uhr des
// Geraets von der des PCs abweichen kann. Ohne RemainingSeconds ist nichts geplant.
public sealed record ShutdownTimerMessage(int? RemainingSeconds)
{
    public string Type => "shutdownTimer";
}
