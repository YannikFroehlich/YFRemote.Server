namespace YFRemote.Server.Services;

// Waehrend der Benutzerkontensteuerung oder des Sperrbildschirms laeuft der sichere Desktop: Windows
// weist dann jede Eingabe mit ERROR_ACCESS_DENIED ab, das ist kein Fehler von YFRemote. Ebenso
// verwirft Windows Eingaben an ein Admin-Fenster (ElevatedWindowMessage). Der Client erkennt die
// Meldungen am Text und zeigt sie uebersetzt an (remote.service.ts) - nicht aendern.
public sealed class InputBlockedException(string message = InputBlockedException.SecureDesktopMessage)
    : InvalidOperationException(message)
{
    public const string SecureDesktopMessage = "Input is blocked by a secure desktop (UAC prompt or lock screen).";

    public const string ElevatedWindowMessage = "Input to an administrator window needs the lock screen and UAC service.";
}
