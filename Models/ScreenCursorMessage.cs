namespace YFRemote.Server.Models;

// Form des Mauszeigers am PC als CSS-Wert ("default", "text", "pointer", ...), an Geraete, deren
// Maus gerade ueber dem Bild im Tab "Bildschirm" ist ("screenCursor").
public sealed record ScreenCursorMessage(string Shape)
{
    public string Type => "screenCursor";
}
