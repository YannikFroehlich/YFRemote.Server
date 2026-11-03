namespace YFRemote.Server.Services;

public interface IScreenCapture
{
    // Der Hauptbildschirm als JPEG, hoechstens maxWidth Pixel breit, mit JPEG-Qualitaet quality.
    byte[] CaptureJpeg(int maxWidth, int quality);
}
