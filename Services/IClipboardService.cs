namespace YFRemote.Server.Services;

public interface IClipboardService
{
    Task SetTextAsync(string text);

    Task SetImageAsync(Stream imageStream);

    Task<string?> GetTextAsync();

    // Als PNG; null, wenn die Zwischenablage kein Bild enthaelt.
    Task<byte[]?> GetImageAsync();
}
