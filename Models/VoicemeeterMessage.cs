namespace YFRemote.Server.Models;

// Alle Voicemeeter-Kanaele fuer den Tab "Mixer" ("voicemeeter"). Id ist der Parameter-Praefix
// ("Strip[3]", "Bus[0]"), Gain in dB (-60 bis +12), Routes die Busse, auf die ein Eingang
// schalten kann ("A1", ..., "B3"). Ohne Channels laeuft Voicemeeter nicht.
public sealed record VoicemeeterMessage(
    IReadOnlyList<VoicemeeterChannel>? Channels,
    IReadOnlyList<string>? Routes)
{
    public string Type => "voicemeeter";

    // Records vergleichen Listen nur per Referenz - PollingBroadcaster meldete sonst jede Sekunde.
    public bool Equals(VoicemeeterMessage? other) =>
        other is not null && SameItems(Channels, other.Channels) && SameItems(Routes, other.Routes);

    public override int GetHashCode() => HashCode.Combine(Channels?.Count, Routes?.Count);

    private static bool SameItems<T>(IReadOnlyList<T>? left, IReadOnlyList<T>? right) =>
        left is null ? right is null : right is not null && left.SequenceEqual(right);
}

public sealed record VoicemeeterChannel(string Id, string Name, bool Muted, double Gain);
