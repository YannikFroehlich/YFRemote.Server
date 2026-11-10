namespace YFRemote.Server.Models;

// Eine neue Windows-Benachrichtigung, an Geraete mit eingeschalteter Weiterleitung ("notifications").
public sealed record PcNotificationMessage(uint Id, string App, string Title, string Text)
{
    public string Type => "notification";
}
