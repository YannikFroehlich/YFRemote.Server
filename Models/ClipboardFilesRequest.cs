namespace YFRemote.Server.Models;

// Namen von Dateien im Empfangsordner (wie POST /files sie zurueckgibt).
public sealed record ClipboardFilesRequest
{
    public IReadOnlyList<string>? Names { get; init; }
}
