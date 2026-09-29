using System.ComponentModel;
using System.Diagnostics;
using System.Text;

namespace YFRemote.Server.Services;

// Kein eigener Wayland-/X11-Client: wl-clipboard (Wayland) bzw. xclip (X11) erledigen das und sind
// in jeder gaengigen Distribution paketiert. Fehlt das Werkzeug oder die Sitzung, bleibt es bei
// einer NotSupportedException (501) mit Hinweis, was fehlt.
public sealed class LinuxClipboardService : IClipboardService
{
    private static readonly TimeSpan CommandTimeout = TimeSpan.FromSeconds(5);

    // Meldungen, mit denen wl-paste/xclip eine leere oder textlose Zwischenablage quittieren -
    // das ist kein Fehler, sondern "kein Text".
    private static readonly string[] EmptyClipboardMessages =
        ["Nothing is copied", "No suitable type", "not available"];

    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47];
    private static readonly byte[] JpegSignature = [0xFF, 0xD8, 0xFF];

    public Task SetTextAsync(string text) =>
        WriteAsync(Encoding.UTF8.GetBytes(text), mimeType: null);

    public async Task SetImageAsync(Stream imageStream)
    {
        using var buffer = new MemoryStream();
        await imageStream.CopyToAsync(buffer);
        var bytes = buffer.ToArray();

        var mimeType = DetectImageType(bytes)
            ?? throw new NotSupportedException("Only PNG and JPEG images can be copied to the clipboard on Linux.");
        await WriteAsync(bytes, mimeType);
    }

    public async Task<string?> GetTextAsync()
    {
        var backend = GetBackend();
        var startInfo = backend.Kind == ClipboardBackendKind.Wayland
            ? CreateStartInfo(backend, "wl-paste", "--no-newline", "--type", "text")
            : CreateStartInfo(backend, "xclip", "-selection", "clipboard", "-out");
        startInfo.RedirectStandardOutput = true;
        startInfo.RedirectStandardError = true;
        startInfo.StandardOutputEncoding = Encoding.UTF8;

        using var process = Start(startInfo);
        using var timeout = new CancellationTokenSource(CommandTimeout);
        var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
        var error = process.StandardError.ReadToEndAsync(timeout.Token);
        await WaitAsync(process, timeout.Token);

        if (process.ExitCode == 0)
        {
            return await output;
        }

        var message = (await error).Trim();
        if (EmptyClipboardMessages.Any(empty => message.Contains(empty, StringComparison.OrdinalIgnoreCase)))
        {
            return null;
        }

        throw new InvalidOperationException($"{startInfo.FileName} exited with code {process.ExitCode}: {message}");
    }

    // Vom aktuellen Prozess getrennt, damit sich die Auswahl ohne echte Sitzung testen laesst.
    public static ClipboardBackend? SelectBackend(Func<string, string?> getEnvironmentVariable)
    {
        var waylandDisplay = getEnvironmentVariable("WAYLAND_DISPLAY");
        if (!string.IsNullOrEmpty(waylandDisplay))
        {
            return new ClipboardBackend(ClipboardBackendKind.Wayland, waylandDisplay);
        }

        // Als systemd --user-Dienst startet YFRemote vor der grafischen Sitzung und erbt deren
        // WAYLAND_DISPLAY nicht - der Socket liegt aber trotzdem im Laufzeitordner des Benutzers.
        var runtimeDirectory = getEnvironmentVariable("XDG_RUNTIME_DIR");
        if (!string.IsNullOrEmpty(runtimeDirectory) && Directory.Exists(runtimeDirectory))
        {
            var socket = Directory.EnumerateFiles(runtimeDirectory, "wayland-*")
                .Select(Path.GetFileName)
                .Where(name => name is not null && !name.EndsWith(".lock", StringComparison.Ordinal))
                .Order(StringComparer.Ordinal)
                .FirstOrDefault();
            if (socket is not null)
            {
                return new ClipboardBackend(ClipboardBackendKind.Wayland, socket);
            }
        }

        var display = getEnvironmentVariable("DISPLAY");
        return string.IsNullOrEmpty(display) ? null : new ClipboardBackend(ClipboardBackendKind.X11, display);
    }

    // Windows dekodiert jedes Bildformat selbst; wl-copy/xclip brauchen dagegen den MIME-Typ, und
    // Browser liefern Zwischenablage-Bilder praktisch immer als PNG, Fotos als JPEG.
    public static string? DetectImageType(ReadOnlySpan<byte> bytes)
    {
        if (bytes.StartsWith(PngSignature))
        {
            return "image/png";
        }

        return bytes.StartsWith(JpegSignature) ? "image/jpeg" : null;
    }

    private static async Task WriteAsync(byte[] content, string? mimeType)
    {
        var backend = GetBackend();
        string[] arguments = backend.Kind == ClipboardBackendKind.Wayland
            ? mimeType is null ? [] : ["--type", mimeType]
            : mimeType is null
                ? ["-selection", "clipboard", "-in"]
                : ["-selection", "clipboard", "-target", mimeType, "-in"];
        var startInfo = CreateStartInfo(backend, backend.Kind == ClipboardBackendKind.Wayland ? "wl-copy" : "xclip", arguments);

        // Nur stdin umleiten: wl-copy und xclip lassen einen Kindprozess im Hintergrund zurueck, der
        // die Zwischenablage weiter anbietet. Er erbt umgeleitete stdout/stderr-Pipes, und das Warten
        // auf deren Ende wuerde nie zurueckkehren.
        startInfo.RedirectStandardInput = true;

        using var process = Start(startInfo);
        using var timeout = new CancellationTokenSource(CommandTimeout);
        await process.StandardInput.BaseStream.WriteAsync(content, timeout.Token);
        process.StandardInput.Close();
        await WaitAsync(process, timeout.Token);

        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"{startInfo.FileName} exited with code {process.ExitCode}.");
        }
    }

    private static ClipboardBackend GetBackend() =>
        SelectBackend(Environment.GetEnvironmentVariable)
            ?? throw new NotSupportedException(
                "No graphical session found (neither WAYLAND_DISPLAY nor DISPLAY is set).");

    private static ProcessStartInfo CreateStartInfo(ClipboardBackend backend, string fileName, params string[] arguments)
    {
        var startInfo = new ProcessStartInfo(fileName, arguments)
        {
            UseShellExecute = false,
            CreateNoWindow = true
        };
        startInfo.Environment[backend.Kind == ClipboardBackendKind.Wayland ? "WAYLAND_DISPLAY" : "DISPLAY"] =
            backend.Display;
        return startInfo;
    }

    private static Process Start(ProcessStartInfo startInfo)
    {
        try
        {
            return Process.Start(startInfo) ?? throw new InvalidOperationException($"Failed to start {startInfo.FileName}.");
        }
        catch (Win32Exception)
        {
            var package = startInfo.FileName == "xclip" ? "xclip" : "wl-clipboard";
            throw new NotSupportedException($"{startInfo.FileName} is not installed (package \"{package}\").");
        }
    }

    private static async Task WaitAsync(Process process, CancellationToken cancellationToken)
    {
        try
        {
            await process.WaitForExitAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            throw new TimeoutException($"{process.StartInfo.FileName} did not finish within {CommandTimeout.TotalSeconds} s.");
        }
    }
}

public enum ClipboardBackendKind
{
    Wayland,
    X11
}

public sealed record ClipboardBackend(ClipboardBackendKind Kind, string Display);
