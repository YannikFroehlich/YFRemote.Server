namespace YFRemote.Server.Models;

public sealed record PairResponse(bool Success, string? Token = null, string? Error = null)
{
    public static PairResponse Ok(string token) => new(true, Token: token);

    public static PairResponse Fail(string error) => new(false, Error: error);
}
