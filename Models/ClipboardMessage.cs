namespace YFRemote.Server.Models;

// Neuer Text in der PC-Zwischenablage, an Geraete mit eingeschaltetem Abgleich ("clipboardSync").
// Ein Bild kommt nur als Kennung (ImageId, ohne Text); das Geraet holt es ueber GET /clipboard/image.
public sealed record ClipboardMessage(string? Text, string? ImageId = null)
{
    public string Type => "clipboard";
}
