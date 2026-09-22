namespace YFRemote.Server.Models;

public sealed record ClipboardTextRequest
{
    public string? Text { get; init; }
}
