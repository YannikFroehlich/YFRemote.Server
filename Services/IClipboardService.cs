namespace YFRemote.Server.Services;

public interface IClipboardService
{
    Task SetTextAsync(string text);

    Task SetImageAsync(Stream imageStream);
}
