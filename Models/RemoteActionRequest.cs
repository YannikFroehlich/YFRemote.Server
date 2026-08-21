namespace YFRemote.Server.Models;

public sealed record RemoteActionRequest
{
    public string? Type { get; init; }

    public IReadOnlyList<string>? Keys { get; init; }

    public string? Text { get; init; }

    public int? DeltaX { get; init; }

    public int? DeltaY { get; init; }

    public string? Button { get; init; }

    public int? Delta { get; init; }
}
