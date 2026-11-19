namespace YFRemote.Server.Models;

// Zustand von OBS fuer den Tab "OBS" ("obs"). State: "connected", "offline" (OBS laeuft nicht),
// "disabled" (WebSocket-Server in OBS ausgeschaltet) oder "authFailed" (Passwort falsch). Szenen,
// Ausgaben und Audioquellen gibt es nur verbunden; Scenes und Sources in der Reihenfolge der Listen
// in OBS. StreamSeconds/RecordSeconds nur, solange die Ausgabe laeuft. ReplayBuffer und VirtualCam
// null, wo OBS sie nicht anbietet (Wiederholungspuffer in den Ausgabe-Einstellungen aus).
public sealed record ObsMessage(
    string State,
    IReadOnlyList<string>? Scenes = null,
    string? CurrentScene = null,
    bool Streaming = false,
    bool Recording = false,
    bool RecordPaused = false,
    IReadOnlyList<ObsInput>? Inputs = null,
    int? StreamSeconds = null,
    int? RecordSeconds = null,
    bool? ReplayBuffer = null,
    bool? VirtualCam = null,
    IReadOnlyList<ObsSceneItem>? Sources = null)
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
        && StreamSeconds == other.StreamSeconds
        && RecordSeconds == other.RecordSeconds
        && ReplayBuffer == other.ReplayBuffer
        && VirtualCam == other.VirtualCam
        && SameItems(Scenes, other.Scenes)
        && SameItems(Inputs, other.Inputs)
        && SameItems(Sources, other.Sources);

    public override int GetHashCode() => HashCode.Combine(State, CurrentScene, Scenes?.Count, Inputs?.Count);

    private static bool SameItems<T>(IReadOnlyList<T>? left, IReadOnlyList<T>? right) =>
        left is null ? right is null : right is not null && left.SequenceEqual(right);
}

// Volume in dB wie der Fader in OBS (-100 = ganz unten).
public sealed record ObsInput(string Name, bool Muted, double Volume = 0);

// Eine Quelle der aktuellen Szene; Id ist OBS' sceneItemId, Enabled ihr Auge in der Quellenliste.
public sealed record ObsSceneItem(int Id, string Name, bool Enabled);
