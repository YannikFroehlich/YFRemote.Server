namespace YFRemote.Server.Services;

public interface IScreenCapture
{
    // Der Hauptbildschirm als JPEG, hoechstens maxWidth Pixel breit.
    byte[] CaptureJpeg(int maxWidth);
}
