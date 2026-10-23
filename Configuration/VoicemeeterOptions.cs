using System.Text.RegularExpressions;

namespace YFRemote.Server.Configuration;

public sealed partial class VoicemeeterOptions
{
    public const string SectionName = "Voicemeeter";

    // Kanal ("Strip[3]", "Bus[0]") fuer Stumm-Button, Lautstaerke-Regler und Medienleiste. Leer:
    // der Voicemeeter-Eingang hinter dem Windows-Standardgeraet, siehe WindowsVoicemeeter.
    public string? Target { get; init; }

    public void Validate()
    {
        if (Target is not null && !TargetPattern().IsMatch(Target))
        {
            throw new InvalidOperationException("Voicemeeter:Target must look like Strip[3] or Bus[0].");
        }
    }

    [GeneratedRegex(@"^(Strip|Bus)\[[0-7]\]$")]
    private static partial Regex TargetPattern();
}
