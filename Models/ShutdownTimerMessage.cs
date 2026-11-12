namespace YFRemote.Server.Models;

// Wie FileOfferMessage eine ungefragte Server-Nachricht. Restzeit statt Uhrzeit, weil die Uhr des
// Geraets von der des PCs abweichen kann. Ohne RemainingSeconds ist nichts geplant. Action ist
// "shutdown", "sleep" oder "displayOff" (fehlt bei einem aelteren Server: dann "shutdown").
public sealed record ShutdownTimerMessage(int? RemainingSeconds, string? Action = null)
{
    public string Type => "shutdownTimer";
}
