namespace YFRemote.Server.Models;

// "Gerät suchen" im Tray: das Geraet klingelt, bis es dort jemand stoppt.
public sealed record RingMessage
{
    public string Type => "ring";
}
