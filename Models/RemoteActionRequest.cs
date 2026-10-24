namespace YFRemote.Server.Models;

public sealed record RemoteActionRequest
{
    public string? RequestId { get; init; }

    public string? Type { get; init; }

    public IReadOnlyList<string>? Keys { get; init; }

    public string? Text { get; init; }

    public int? DeltaX { get; init; }

    public int? DeltaY { get; init; }

    public string? Button { get; init; }

    public int? Delta { get; init; }

    public GamepadState? Gamepad { get; init; }

    public bool? Enabled { get; init; }

    public int? Volume { get; init; }

    public int? Minutes { get; init; }

    public string? Parameter { get; init; }

    public double? Value { get; init; }

    public double? Position { get; init; }

    public string? Id { get; init; }

    public string? Name { get; init; }

    public bool? Muted { get; init; }

    public string? Url { get; init; }
}
