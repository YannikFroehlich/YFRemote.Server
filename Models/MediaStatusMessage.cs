namespace YFRemote.Server.Models;

// Ungefragte Server-Nachricht wie FileOfferMessage: Lautstaerke (0-100, null ohne Ausgabegeraet)
// und was gerade laeuft (Titel null, wenn keine App Medien meldet). Kommt beim Verbinden und bei
// jeder Aenderung.
public sealed record MediaStatusMessage(int? Volume, bool Muted, string? Title, string? Artist, bool Playing)
{
    public string Type => "media";
}
