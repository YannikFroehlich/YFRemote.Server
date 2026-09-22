namespace YFRemote.Server.Models;

public sealed record ClipboardResponse(bool Success, string? Error = null)
{
    public static ClipboardResponse Ok() => new(true);

    public static ClipboardResponse Fail(string error) => new(false, Error: error);
}
