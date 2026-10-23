namespace YFRemote.Server.Models;

// Ungefragte Server-Nachricht wie FileOfferMessage: Lautstaerke (0-100, null ohne Ausgabegeraet)
// und was gerade laeuft (Titel null, wenn keine App Medien meldet). Kommt beim Verbinden und bei
// jeder Aenderung. Position und Duration in Sekunden, null ohne Zeitleiste (Livestream, App ohne
// Laenge); CanSeek: die App laesst sich per "mediaSeek" spulen. CoverId wechselt mit dem
// Albumcover, das GET /media/cover liefert.
public sealed record MediaStatusMessage(
    int? Volume,
    bool Muted,
    string? Title,
    string? Artist,
    bool Playing,
    int? Position = null,
    int? Duration = null,
    bool CanSeek = false,
    string? CoverId = null)
{
    public string Type => "media";
}
