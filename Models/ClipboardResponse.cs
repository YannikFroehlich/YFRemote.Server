namespace YFRemote.Server.Models;

public sealed record ClipboardResponse(bool Success, string? Error = null, string? Text = null, string? ImageId = null)
{
    public static ClipboardResponse Ok() => new(true);

    public static ClipboardResponse WithText(string? text) => new(true, Text: text);

    public static ClipboardResponse WithImageId(string? imageId) => new(true, ImageId: imageId);

    public static ClipboardResponse Fail(string error) => new(false, Error: error);
}
