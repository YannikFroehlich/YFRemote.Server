namespace YFRemote.Server.Models;

public sealed record RemoteActionResponse(bool Success, string? Error = null)
{
    public static RemoteActionResponse Ok() => new(true);

    public static RemoteActionResponse Fail(string error) => new(false, error);
}
