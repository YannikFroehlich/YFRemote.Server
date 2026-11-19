namespace YFRemote.Server.Models;

// Zustand von OBS fuer den Tab "OBS" ("obs"). State: "connected", "offline" (OBS laeuft nicht),
// "disabled" (WebSocket-Server in OBS ausgeschaltet) oder "authFailed" (Passwort falsch). Szenen,
// Ausgaben und Audioquellen gibt es nur verbunden; Scenes in der Reihenfolge der Liste in OBS.
public sealed record ObsMessage(
    string State,
    IReadOnlyList<string>? Scenes = null,
    string? CurrentScene = null,
    bool Streaming = false,
    bool Recording = false,
    bool RecordPaused = false,
    IReadOnlyList<ObsInput>? Inputs = null)
{
    public string Type => "obs";

    // Records vergleichen Listen nur per Referenz - PollingBroadcaster meldete sonst jede Sekunde.
    public bool Equals(ObsMessage? other) =>
        other is not null
        && State == other.State
        && CurrentScene == other.CurrentScene
        && Streaming == other.Streaming
        && Recording == other.Recording
        && RecordPaused == other.RecordPaused
        && SameItems(Scenes, other.Scenes)
        && SameItems(Inputs, other.Inputs);

    public override int GetHashCode() => HashCode.Combine(State, CurrentScene, Scenes?.Count, Inputs?.Count);

    private static bool SameItems<T>(IReadOnlyList<T>? left, IReadOnlyList<T>? right) =>
        left is null ? right is null : right is not null && left.SequenceEqual(right);
}

public sealed record ObsInput(string Name, bool Muted);
