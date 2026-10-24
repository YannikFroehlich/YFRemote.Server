using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Lautstaerke ueber pactl (PulseAudio und PipeWire mit pipewire-pulse), Titel ueber playerctl
// (MPRIS: Spotify, Browser, VLC, ...). Fehlt ein Werkzeug, bleibt nur dieser Teil leer - wie unter
// Windows ohne Wiedergabegeraet oder Medien-App.
// ponytail: bis zu drei Prozessstarts pro Sekunde, solange ein Geraet verbunden ist; D-Bus/pactl
// subscribe erst, wenn das auf schwacher Hardware messbar stoert.
public sealed partial class LinuxMediaStatusReader : IVolumeService, IMediaControl, IAppVolumeService
{
    private static readonly TimeSpan CommandTimeout = TimeSpan.FromSeconds(2);

    // Wie unter Windows: Cover um 300x300 Pixel haben einige 10 KB, groessere schickt YFRemote nicht.
    private const int MaxCoverBytes = 2 * 1024 * 1024;

    private static readonly HttpClient CoverClient = new() { Timeout = TimeSpan.FromSeconds(5) };

    private readonly Lock coverLock = new();
    private MediaCover? cover;
    private string? coverKey;

    public MediaCover? Cover
    {
        get
        {
            lock (coverLock)
            {
                return cover;
            }
        }
    }

    public async Task<MediaStatusMessage> ReadAsync()
    {
        var volume = ParseVolume(await RunAsync("pactl", "get-sink-volume", "@DEFAULT_SINK@"));
        var muted = volume is not null
            && ParseMuted(await RunAsync("pactl", "get-sink-mute", "@DEFAULT_SINK@"));
        var (nowPlaying, artUrl) = ParseNowPlaying(await RunAsync(
            "playerctl",
            "metadata",
            "--format",
            "{{status}}\t{{position}}\t{{mpris:length}}\t{{mpris:artUrl}}\t{{title}}\t{{artist}}"));
        UpdateCover(artUrl, nowPlaying.Title);
        return nowPlaying with { Volume = volume, Muted = muted, CoverId = Cover?.Id };
    }

    // MPRIS liefert nur eine URL: Browser und VLC eine lokale file://-Datei, Spotify eine https-
    // Adresse. Geladen wird nur bei neuer URL oder neuem Titel (manche Player schreiben jedes Cover
    // in dieselbe Datei) und neben dem sekuendlichen Abruf, damit ein langsamer Server die
    // Medienleiste nicht aufhaelt; das Cover kommt dann mit der naechsten Meldung.
    // ponytail: ein gescheitertes Laden wird erst beim naechsten Titel wiederholt.
    private void UpdateCover(string? artUrl, string? title)
    {
        var key = artUrl is null ? null : $"{artUrl}\n{title}";
        lock (coverLock)
        {
            if (key == coverKey)
            {
                return;
            }

            coverKey = key;
            cover = null;
        }

        if (artUrl is not null)
        {
            _ = LoadCoverAsync(artUrl, key);
        }
    }

    private async Task LoadCoverAsync(string artUrl, string? key)
    {
        var loaded = await ReadCoverAsync(artUrl);
        lock (coverLock)
        {
            // Inzwischen laeuft vielleicht schon der naechste Titel.
            if (loaded is not null && key == coverKey)
            {
                cover = loaded;
            }
        }
    }

    // Nur PNG und JPEG (wie bei der Zwischenablage am Inhalt erkannt), nur file und http(s). Jeder
    // Fehler kostet nur das Cover.
    internal static async Task<MediaCover?> ReadCoverAsync(string artUrl)
    {
        try
        {
            if (!Uri.TryCreate(artUrl, UriKind.Absolute, out var uri))
            {
                return null;
            }

            byte[]? data = null;
            if (uri.IsFile)
            {
                var file = new FileInfo(uri.LocalPath);
                if (file.Exists && file.Length is > 0 and <= MaxCoverBytes)
                {
                    data = await File.ReadAllBytesAsync(file.FullName);
                }
            }
            else if (uri.Scheme is "http" or "https")
            {
                using var response = await CoverClient.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead);
                if (response.IsSuccessStatusCode && response.Content.Headers.ContentLength is null or <= MaxCoverBytes)
                {
                    await using var stream = await response.Content.ReadAsStreamAsync();
                    data = await ReadAtMostAsync(stream, MaxCoverBytes);
                }
            }

            return data is not null && LinuxClipboardService.DetectImageType(data) is { } contentType
                ? new MediaCover(data, contentType, Convert.ToHexStringLower(SHA256.HashData(data))[..16])
                : null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    // null, wenn mehr als maxBytes kommen - Content-Length kann fehlen oder luegen.
    private static async Task<byte[]?> ReadAtMostAsync(Stream stream, int maxBytes)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(chunk)) > 0)
        {
            if (buffer.Length + read > maxBytes)
            {
                return null;
            }

            buffer.Write(chunk, 0, read);
        }

        return buffer.Length == 0 ? null : buffer.ToArray();
    }

    public async Task<AppVolumesMessage> ReadAppsAsync() =>
        new(
            ParseSinkInputs(await RunAsync("pactl", "list", "sink-inputs")),
            ParseSinks(await RunAsync("pactl", "list", "sinks"), (await RunAsync("pactl", "get-default-sink"))?.Trim()));

    // PipeWire und neuere PulseAudio-Versionen ziehen laufende Streams mit auf das neue Geraet.
    public void SetOutput(string id)
    {
        if (RunAsync("pactl", "set-default-sink", id).GetAwaiter().GetResult() is null)
        {
            throw new NotSupportedException("pactl failed or is not installed.");
        }
    }

    // "Sink #0" leitet einen Eintrag ein, darunter "Name:" (die Id fuer set-default-sink) und
    // "Description:" (der Name wie in den Toneinstellungen).
    internal static IReadOnlyList<AudioOutput> ParseSinks(string? output, string? defaultSink)
    {
        const string namePrefix = "Name: ";
        const string descriptionPrefix = "Description: ";
        var outputs = new List<AudioOutput>();
        string? id = null;

        foreach (var line in (output ?? "").Split('\n').Select(line => line.Trim()))
        {
            if (line.StartsWith("Sink #", StringComparison.Ordinal))
            {
                id = null;
            }
            else if (line.StartsWith(namePrefix, StringComparison.Ordinal))
            {
                id = line[namePrefix.Length..];
            }
            else if (id is not null && line.StartsWith(descriptionPrefix, StringComparison.Ordinal))
            {
                outputs.Add(new AudioOutput(id, line[descriptionPrefix.Length..], id == defaultSink));
                id = null;
            }
        }

        return [.. outputs.OrderBy(output => output.Name, StringComparer.CurrentCultureIgnoreCase)];
    }

    // Die Id ist die Nummer des Sink-Inputs. ponytail: ein Eintrag je Stream statt je App - spielt
    // ein Browser zwei Tabs ab, stehen dort zwei Regler.
    public void SetApp(string id, int? volume, bool? muted)
    {
        if (!id.All(char.IsAsciiDigit)
            || (volume is { } level
                && RunAsync("pactl", "set-sink-input-volume", id, $"{level}%").GetAwaiter().GetResult() is null)
            || (muted is { } mute
                && RunAsync("pactl", "set-sink-input-mute", id, mute ? "1" : "0").GetAwaiter().GetResult() is null))
        {
            throw new NotSupportedException("This app no longer plays sound.");
        }
    }

    // "Sink Input #42" leitet einen Eintrag ein, darunter "Mute:", "Volume:" und unter Properties
    // application.name; die Namen kommen dank LANGUAGE=en auf Englisch.
    internal static IReadOnlyList<AppVolume> ParseSinkInputs(string? output)
    {
        const string header = "Sink Input #";
        const string nameProperty = "application.name = ";
        var apps = new List<AppVolume>();
        string? id = null;
        string? name = null;
        var volume = 0;
        var muted = false;

        foreach (var line in (output ?? "").Split('\n').Select(line => line.Trim()))
        {
            if (line.StartsWith(header, StringComparison.Ordinal))
            {
                AddCurrent();
                (id, name, volume, muted) = (line[header.Length..], null, 0, false);
            }
            else if (line.StartsWith("Mute:", StringComparison.Ordinal))
            {
                muted = ParseMuted(line);
            }
            else if (line.StartsWith("Volume:", StringComparison.Ordinal))
            {
                volume = ParseVolume(line) ?? 0;
            }
            else if (line.StartsWith(nameProperty, StringComparison.Ordinal))
            {
                name = line[nameProperty.Length..].Trim('"');
            }
        }

        AddCurrent();
        return [.. apps.OrderBy(app => app.Name, StringComparer.CurrentCultureIgnoreCase)];

        void AddCurrent()
        {
            if (id is not null)
            {
                apps.Add(new AppVolume(id, name ?? $"Stream {id}", volume, muted));
            }
        }
    }

    public void Seek(double seconds)
    {
        if (RunAsync("playerctl", "position", seconds.ToString(CultureInfo.InvariantCulture)).GetAwaiter().GetResult() is null)
        {
            throw new NotSupportedException("playerctl failed or no player is running.");
        }
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

    // "Playing\t<Position in us>\t<Laenge in us>\t<Cover-URL>\tTitel\tInterpret"; Laenge fehlt bei
    // Livestreams, die Cover-URL bei Playern ohne Bild. Ob ein Player spulen kann, verraet playerctl
    // nicht - mit Laenge wird es versucht.
    internal static (MediaStatusMessage Status, string? ArtUrl) ParseNowPlaying(string? output)
    {
        var parts = output?.TrimEnd('\n').Split('\t', 6);
        if (parts is not { Length: 6 })
        {
            return (new MediaStatusMessage(null, false, null, null, false), null);
        }

        var length = Seconds(parts[2]);
        int? duration = length > 0 ? length : null;
        int? position = duration is null ? null : Math.Min(Seconds(parts[1]) ?? 0, duration.Value);
        var status = new MediaStatusMessage(
            null,
            false,
            NullIfEmpty(parts[4]),
            NullIfEmpty(parts[5]),
            parts[0] == "Playing",
            position,
            duration,
            duration is not null);
        return (status, NullIfEmpty(parts[3]));
    }

    private static int? Seconds(string microseconds) =>
        long.TryParse(microseconds, NumberStyles.None, CultureInfo.InvariantCulture, out var value)
            ? (int)(value / 1_000_000)
            : null;

    private static string? NullIfEmpty(string value) => string.IsNullOrWhiteSpace(value) ? null : value;

    // null, wenn das Werkzeug fehlt oder scheitert - playerctl ohne laufenden Player endet z.B.
    // mit "No players found" und Exitcode 1.
    internal static async Task<string?> RunAsync(string fileName, params string[] arguments)
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
