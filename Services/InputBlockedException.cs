namespace YFRemote.Server.Services;

// Waehrend der Benutzerkontensteuerung oder des Sperrbildschirms laeuft der sichere Desktop: Windows
// weist dann jede Eingabe mit ERROR_ACCESS_DENIED ab, das ist kein Fehler von YFRemote. Der Client
// erkennt die Meldung am Text und zeigt sie uebersetzt an (remote.service.ts) - nicht aendern.
public sealed class InputBlockedException()
    : InvalidOperationException("Input is blocked by a secure desktop (UAC prompt or lock screen).");
