namespace YFRemote.Server.Models;

public sealed record PairedDeviceInfo(
    Guid Id,
    string Name,
    DateTimeOffset PairedAtUtc,
    DateTimeOffset LastSeenUtc,
    bool MediaOnly = false);
