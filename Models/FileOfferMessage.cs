namespace YFRemote.Server.Models;

// Wie GamepadRumble eine ungefragte Server-Nachricht: der PC bietet eine Datei an, das Geraet
// laedt sie bei Bedarf ueber GET /files/{id}.
public sealed record FileOfferMessage(Guid Id, string Name, long Size)
{
    public string Type => "fileOffer";
}
