namespace YFRemote.Server.Services;

public interface IClipboardService
{
    Task SetTextAsync(string text);

    Task SetImageAsync(Stream imageStream);

    Task<string?> GetTextAsync();

    // Als PNG; null, wenn die Zwischenablage kein Bild enthaelt.
    Task<byte[]?> GetImageAsync();

    // Aendert sich mit jedem neu kopierten Bild; null ohne Bild. Der Abgleich fragt sie jede
    // Sekunde ab, statt jedes Mal ein PNG zu erzeugen.
    Task<string?> GetImageIdAsync();

    // Wie "Kopieren" im Explorer: Strg+V fuegt die Dateien danach in einen Ordner oder Chat ein.
    Task SetFilesAsync(IReadOnlyList<string> paths);
}
