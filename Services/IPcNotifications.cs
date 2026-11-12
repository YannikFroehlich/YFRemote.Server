namespace YFRemote.Server.Services;

// Windows-Benachrichtigungen, die ein Geraet angezeigt bekommt (WindowsNotificationReader). Nur unter
// Windows registriert; RemoteActionHandler lehnt "dismissNotification" ohne ab.
public interface IPcNotifications
{
    // Entfernt die Benachrichtigung auch im Info-Center des PCs. Eine unbekannte Kennung ist kein Fehler:
    // die Benachrichtigung kann am PC schon weggeklickt sein.
    void Dismiss(uint id);
}
