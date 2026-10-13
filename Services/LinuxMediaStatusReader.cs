using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Lautstaerke ueber pactl (PulseAudio und PipeWire mit pipewire-pulse), Titel ueber playerctl
// (MPRIS: Spotify, Browser, VLC, ...). Fehlt ein Werkzeug, bleibt nur dieser Teil leer - wie unter
// Windows ohne Wiedergabegeraet oder Medien-App.
// ponytail: bis zu drei Prozessstarts pro Sekunde, solange ein Geraet verbunden ist; D-Bus/pactl
// subscribe erst, wenn das auf schwacher Hardware messbar stoert.
public sealed partial class LinuxMediaStatusReader : IVolumeService
{
    private static readonly TimeSpan CommandTimeout = TimeSpan.FromSeconds(2);

    public async Task<MediaStatusMessage> ReadAsync()
    {
        var volume = ParseVolume(await RunAsync("pactl", "get-sink-volume", "@DEFAULT_SINK@"));
        var muted = volume is not null
            && ParseMuted(await RunAsync("pactl", "get-sink-mute", "@DEFAULT_SINK@"));
        var (title, artist, playing) = ParseNowPlaying(
            await RunAsync("playerctl", "metadata", "--format", "{{status}}\t{{title}}\t{{artist}}"));
        return new MediaStatusMessage(volume, muted, title, artist, playing);
    }

    // Wie unter Windows: wer die Lautstaerke zieht, will auch etwas hoeren. Der Aufrufer ist
    // synchron, pactl kehrt sofort zurueck.
    public void SetVolume(int percent)
    {
        if (RunAsync("pactl", "set-sink-volume", "@DEFAULT_SINK@", $"{percent}%").GetAwaiter().GetResult() is null
            || RunAsync("pactl", "set-sink-mute", "@DEFAULT_SINK@", "0").GetAwaiter().GetResult() is null)
        {
            throw new InvalidOperationException("pactl failed or is not installed.");
        }
    }

    // "Volume: front-left: 29491 /  45% / -20.81 dB,   front-right: ..." - der erste Kanal zaehlt.
    // pactl erlaubt mehr als 100 %, die Anzeige auf dem Geraet endet wie unter Windows bei 100.
    internal static int? ParseVolume(string? output) =>
        output is not null && PercentPattern().Match(output) is { Success: true } match
            ? Math.Min(int.Parse(match.Groups[1].ValueSpan), 100)
            : null;

    internal static bool ParseMuted(string? output) =>
        output?.Trim().Equals("Mute: yes", StringComparison.OrdinalIgnoreCase) == true;

    internal static (string? Title, string? Artist, bool Playing) ParseNowPlaying(string? output)
    {
        var parts = output?.TrimEnd('\n').Split('\t', 3);
        if (parts is not { Length: 3 })
        {
            return (null, null, false);
        }

        return (NullIfEmpty(parts[1]), NullIfEmpty(parts[2]), parts[0] == "Playing");
    }

    private static string? NullIfEmpty(string value) => string.IsNullOrWhiteSpace(value) ? null : value;

    // null, wenn das Werkzeug fehlt oder scheitert - playerctl ohne laufenden Player endet z.B.
    // mit "No players found" und Exitcode 1.
    private static async Task<string?> RunAsync(string fileName, params string[] arguments)
    {
        var startInfo = new ProcessStartInfo(fileName, arguments)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8
        };
        // pactl uebersetzt "Mute: yes" in die Systemsprache. LANGUAGE aendert nur die Meldungen,
        // nicht den Zeichensatz der Titel wie LC_ALL=C es taete.
        startInfo.Environment["LANGUAGE"] = "en";

        Process? process;
        try
        {
            process = Process.Start(startInfo);
        }
        catch (Win32Exception)
        {
            return null;
        }

        if (process is null)
        {
            return null;
        }

        using (process)
        using (var timeout = new CancellationTokenSource(CommandTimeout))
        {
            try
            {
                var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
                _ = process.StandardError.ReadToEndAsync(timeout.Token);
                await process.WaitForExitAsync(timeout.Token);
                return process.ExitCode == 0 ? await output : null;
            }
            catch (OperationCanceledException)
            {
                process.Kill(entireProcessTree: true);
                return null;
            }
        }
    }

    [GeneratedRegex(@"(\d+)%")]
    private static partial Regex PercentPattern();
}
