namespace YFRemote.Server.Services;

public interface IScreenCapture
{
    // Der Hauptbildschirm als JPEG, hoechstens maxWidth Pixel breit, mit JPEG-Qualitaet quality.
    byte[] CaptureJpeg(int maxWidth, int quality);

    // Der Hauptbildschirm als H.264 in fragmentiertem MP4, bis cancellationToken abbricht.
    // onStart bekommt die Codec-Angabe fuer MediaSource, bevor das erste Stueck kommt.
    // NotSupportedException ohne Hardware-Encoder - dann bleibt der Client bei JPEG.
    Task StreamVideoAsync(int maxWidth, int bitrateKbps, Action<string> onStart, Func<byte[], Task> onFragment, CancellationToken cancellationToken);
}
