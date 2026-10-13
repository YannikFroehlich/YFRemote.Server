namespace YFRemote.Server.Services;

public interface IVolumeService
{
    // 0-100, gilt fuer das Standard-Wiedergabegeraet.
    void SetVolume(int percent);
}
