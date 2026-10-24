namespace YFRemote.Server.Models;

// Lautstaerke pro App fuer den Tab "Mixer" ("apps"), solange ein Geraet zusieht. Id ist unter
// Windows die Prozessnummer oder "system" (Systemklaenge), unter Linux die Nummer des
// Sink-Inputs; Volume 0-100. Outputs sind die Wiedergabegeraete, Default das aktuelle.
public sealed record AppVolumesMessage(IReadOnlyList<AppVolume> Apps, IReadOnlyList<AudioOutput>? Outputs = null)
{
    public string Type => "apps";

    // Records vergleichen Listen nur per Referenz - PollingBroadcaster meldete sonst jede Sekunde.
    public bool Equals(AppVolumesMessage? other) =>
        other is not null
        && Apps.SequenceEqual(other.Apps)
        && (Outputs ?? []).SequenceEqual(other.Outputs ?? []);

    public override int GetHashCode() => Apps.Count;
}

public sealed record AppVolume(string Id, string Name, int Volume, bool Muted);

// Id ist unter Windows die Endpunkt-Id von Core Audio, unter Linux der Sink-Name von pactl.
public sealed record AudioOutput(string Id, string Name, bool Default);
