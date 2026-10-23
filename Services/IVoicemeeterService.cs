using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

public interface IVoicemeeterService
{
    // Faderbereich in dB, gleich fuer Eingaenge und Busse.
    const double MinGain = -60;
    const double MaxGain = 12;

    // Die Remote-API liegt im Installationsordner; laufen muss Voicemeeter dafuer nicht.
    bool IsInstalled { get; }

    Task<VoicemeeterMessage> ReadAsync();

    // value null schaltet einen Schalter (Mute, A1, ...) um. NotSupportedException, wenn Voicemeeter
    // nicht laeuft oder den Kanal nicht hat.
    void SetParameter(string parameter, float? value);
}
