namespace YFRemote.Server.Models;

// Lautstaerke pro App fuer den Tab "Mixer" ("apps"), solange ein Geraet zusieht. Id ist unter
// Windows die Prozessnummer oder "system" (Systemklaenge), unter Linux die Nummer des
// Sink-Inputs; Volume 0-100.
public sealed record AppVolumesMessage(IReadOnlyList<AppVolume> Apps)
{
    public string Type => "apps";

    // Records vergleichen Listen nur per Referenz - PollingBroadcaster meldete sonst jede Sekunde.
    public bool Equals(AppVolumesMessage? other) => other is not null && Apps.SequenceEqual(other.Apps);

    public override int GetHashCode() => Apps.Count;
}

public sealed record AppVolume(string Id, string Name, int Volume, bool Muted);
