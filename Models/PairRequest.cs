namespace YFRemote.Server.Models;

public sealed record PairRequest
{
    public string? Pin { get; init; }

    public string? DeviceName { get; init; }
}
