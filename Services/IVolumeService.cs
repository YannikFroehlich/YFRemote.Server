namespace YFRemote.Server.Services;

public interface IVolumeService
{
    // 0-100, gilt fuer das Standard-Wiedergabegeraet.
    void SetVolume(int percent);

    // VOLUME_MUTE/UP/DOWN: true, wenn ein Mixer wie Voicemeeter die Taste uebernommen hat; sonst
    // geht sie wie bisher an das Betriebssystem.
    bool TryHandleVolumeKey(string key) => false;

    // Stummschaltung des Standard-Aufnahmegeraets; null ohne Mikrofon oder ohne Unterstuetzung.
    bool? MicMuted => null;

    void SetMicMuted(bool muted) => throw new NotSupportedException("Muting the microphone is not supported.");
}
