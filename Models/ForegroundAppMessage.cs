namespace YFRemote.Server.Models;

// Programm im Vordergrund ("foregroundApp"), solange ein Geraet den automatischen Profilwechsel an
// hat. Name wie in Mixer und Fensterliste (Dateibeschreibung, sonst Prozessname); null ohne Fenster.
public sealed record ForegroundAppMessage(string? Name)
{
    public string Type => "foregroundApp";
}
