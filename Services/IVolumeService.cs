namespace YFRemote.Server.Services;

public interface IVolumeService
{
    // 0-100, gilt fuer das Standard-Wiedergabegeraet.
    void SetVolume(int percent);

    // VOLUME_MUTE/UP/DOWN: true, wenn ein Mixer wie Voicemeeter die Taste uebernommen hat; sonst
    // geht sie wie bisher an das Betriebssystem.
    bool TryHandleVolumeKey(string key) => false;
}
