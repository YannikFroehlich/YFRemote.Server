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

    public async Task<string?> GetTextAsync() =>
        await ReadAsync(mimeType: null) is { } bytes ? Encoding.UTF8.GetString(bytes) : null;

    // Bietet die Quell-App kein PNG an, melden wl-paste/xclip das wie eine leere Zwischenablage.
    public Task<byte[]?> GetImageAsync() => ReadAsync("image/png");

    private static async Task<byte[]?> ReadAsync(string? mimeType)
    {
        var backend = await GetBackendAsync();
        string[] arguments = backend.Kind == ClipboardBackendKind.Wayland
            ? mimeType is null ? ["--no-newline", "--type", "text"] : ["--type", mimeType]
            : mimeType is null
                ? ["-selection", "clipboard", "-out"]
                : ["-selection", "clipboard", "-target", mimeType, "-out"];
        var startInfo = CreateStartInfo(backend, backend.Kind == ClipboardBackendKind.Wayland ? "wl-paste" : "xclip", arguments);
        startInfo.RedirectStandardOutput = true;
        startInfo.RedirectStandardError = true;

        using var process = Start(startInfo);
        using var timeout = new CancellationTokenSource(CommandTimeout);
        using var output = new MemoryStream();
        var copy = process.StandardOutput.BaseStream.CopyToAsync(output, timeout.Token);
        var error = process.StandardError.ReadToEndAsync(timeout.Token);
        await WaitAsync(process, timeout.Token);
        await copy;

        if (process.ExitCode == 0)
        {
            return output.ToArray();
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
        return string.IsNullOrEmpty(display)
            ? null
            : new ClipboardBackend(ClipboardBackendKind.X11, display, getEnvironmentVariable("XAUTHORITY"));
    }

    // "systemctl --user show-environment" gibt je Variable eine Zeile NAME=Wert aus.
    internal static Dictionary<string, string> ParseEnvironment(string output)
    {
        var environment = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var line in output.Split('\n'))
        {
            var separator = line.IndexOf('=');
            if (separator > 0)
            {
                environment[line[..separator]] = line[(separator + 1)..];
            }
        }

        return environment;
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
        var backend = await GetBackendAsync();
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

    private static async Task<ClipboardBackend> GetBackendAsync()
    {
        if (SelectBackend(Environment.GetEnvironmentVariable) is { } backend)
        {
            return backend;
        }

        // Unter X11 gibt es keinen Socket im Laufzeitordner, und DISPLAY fehlt dem systemd --user-Dienst.
        // Die Sitzung meldet DISPLAY und XAUTHORITY aber an systemd (Xsession ruft
        // dbus-update-activation-environment --systemd auf) - erst nach dem Dienststart, deshalb bei
        // jedem Aufruf nachfragen.
        var systemdEnvironment = ParseEnvironment(
            await LinuxMediaStatusReader.RunAsync("systemctl", "--user", "show-environment") ?? "");
        return SelectBackend(name => systemdEnvironment.GetValueOrDefault(name))
            ?? throw new NotSupportedException(
                "No graphical session found (neither WAYLAND_DISPLAY nor DISPLAY is set, not even in the systemd user environment).");
    }

    private static ProcessStartInfo CreateStartInfo(ClipboardBackend backend, string fileName, params string[] arguments)
    {
        var startInfo = new ProcessStartInfo(fileName, arguments)
        {
            UseShellExecute = false,
            CreateNoWindow = true
        };
        startInfo.Environment[backend.Kind == ClipboardBackendKind.Wayland ? "WAYLAND_DISPLAY" : "DISPLAY"] =
            backend.Display;
        if (backend.XAuthority is not null)
        {
            startInfo.Environment["XAUTHORITY"] = backend.XAuthority;
        }

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

public sealed record ClipboardBackend(ClipboardBackendKind Kind, string Display, string? XAuthority = null);
