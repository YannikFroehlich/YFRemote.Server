namespace YFRemote.Server.Models;

// Neuer Text in der PC-Zwischenablage, an Geraete mit eingeschaltetem Abgleich ("clipboardSync").
public sealed record ClipboardMessage(string Text)
{
    public string Type => "clipboard";
}
