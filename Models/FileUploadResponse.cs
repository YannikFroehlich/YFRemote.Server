namespace YFRemote.Server.Models;

public sealed record FileUploadResponse(bool Success, string? FileName = null, string? Error = null)
{
    public static FileUploadResponse Ok(string fileName) => new(true, FileName: fileName);

    public static FileUploadResponse Fail(string error) => new(false, Error: error);
}
