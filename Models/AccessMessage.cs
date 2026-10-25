namespace YFRemote.Server.Models;

// Kommt bei jedem Verbinden zuerst, damit der Client bei "Nur Medien" die gesperrten Tabs ausblendet.
public sealed record AccessMessage(bool MediaOnly)
{
    public string Type => "access";
}
