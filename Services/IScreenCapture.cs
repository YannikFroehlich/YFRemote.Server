namespace YFRemote.Server.Services;

public sealed record ScreenMonitor(string Id, int Left, int Top, int Width, int Height, bool Primary)
{
    // Unbekannte Kennung (Monitor abgezogen, alte Auswahl im Client): der Hauptbildschirm. Aufnahme
    // und Klick loesen gleich auf, Bild und Tipp passen also auch dann zusammen.
    public static ScreenMonitor? Resolve(IReadOnlyList<ScreenMonitor> monitors, string? id) =>
        monitors.FirstOrDefault(monitor => monitor.Id == id)
        ?? monitors.FirstOrDefault(monitor => monitor.Primary)
        ?? monitors.FirstOrDefault();
}

public interface IScreenCapture
{
    // Die Monitore von links nach rechts, in physischen Pixeln.
    IReadOnlyList<ScreenMonitor> ListMonitors();

    // Der Monitor (null = Hauptbildschirm) als JPEG, hoechstens maxWidth Pixel breit, mit
    // JPEG-Qualitaet quality.
    byte[] CaptureJpeg(int maxWidth, int quality, string? monitor);

    // Der Monitor (null = Hauptbildschirm) als H.264 in fragmentiertem MP4, bis cancellationToken
    // abbricht. onStart bekommt die Codec-Angabe fuer MediaSource, bevor das erste Stueck kommt.
    // NotSupportedException ohne Hardware-Encoder - dann bleibt der Client bei JPEG.
    Task StreamVideoAsync(int maxWidth, int bitrateKbps, string? monitor, Action<string> onStart, Func<byte[], Task> onFragment, CancellationToken cancellationToken);
}
