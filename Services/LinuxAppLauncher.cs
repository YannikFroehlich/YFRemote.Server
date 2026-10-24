using System.ComponentModel;
using System.Diagnostics;

namespace YFRemote.Server.Services;

// Apps sind die .desktop-Dateien, die auch das Startmenue der Desktopumgebung zeigt. Gestartet wird
// ueber gio (glib) bzw. xdg-open, beide mit der Sitzung, die schon die Zwischenablage findet.
public sealed class LinuxAppLauncher : IAppLauncher
{
    private const int CommandTimeoutMs = 2000;

    public IReadOnlyList<string> ListApps() =>
        FindDesktopFiles().Keys.Order(StringComparer.CurrentCultureIgnoreCase).ToList();

    public bool TryLaunchApp(string name)
    {
        if (!FindDesktopFiles().TryGetValue(name, out var path))
        {
            return false;
        }

        Run("gio", "launch", path);
        return true;
    }

    public void OpenUrl(Uri url) => Run("xdg-open", url.AbsoluteUri);

    // Name= aus [Desktop Entry], wenn der Eintrag eine sichtbare Anwendung ist; sonst null.
    // ponytail: nur der unuebersetzte Name, Name[de] usw. bleiben unbeachtet.
    internal static string? ParseDesktopEntryName(string content)
    {
        string? name = null;
        var application = false;
        var inEntry = false;
        foreach (var rawLine in content.Split('\n'))
        {
            var line = rawLine.Trim();
            if (line.StartsWith('['))
            {
                inEntry = line == "[Desktop Entry]";
                continue;
            }

            if (!inEntry)
            {
                continue;
            }

            var separator = line.IndexOf('=');
            if (separator <= 0)
            {
                continue;
            }

            var value = line[(separator + 1)..].Trim();
            switch (line[..separator].Trim())
            {
                case "Name":
                    name = value;
                    break;
                case "Type":
                    application = value == "Application";
                    break;
                case "NoDisplay" or "Hidden" when value == "true":
                    return null;
            }
        }

        return application && !string.IsNullOrEmpty(name) ? name : null;
    }

    // Reihenfolge nach der XDG-Spezifikation: der Benutzerordner ueberdeckt die Systemordner. Die
    // Flatpak- und Snap-Ordner fehlen dem systemd --user-Dienst oft in XDG_DATA_DIRS. "/" statt
    // Path.Combine, damit der Test auch unter Windows dieselben Pfade sieht.
    internal static IEnumerable<string> ApplicationDirectories(Func<string, string?> getEnvironmentVariable)
    {
        var home = getEnvironmentVariable("HOME") ?? "";
        var dataHome = getEnvironmentVariable("XDG_DATA_HOME") is { Length: > 0 } configuredHome
            ? configuredHome
            : $"{home}/.local/share";
        var dataDirs = getEnvironmentVariable("XDG_DATA_DIRS") is { Length: > 0 } configuredDirs
            ? configuredDirs.Split(':', StringSplitOptions.RemoveEmptyEntries)
            : ["/usr/local/share", "/usr/share"];

        return new[] { dataHome }
            .Concat(dataDirs)
            .Append($"{home}/.local/share/flatpak/exports/share")
            .Append("/var/lib/flatpak/exports/share")
            .Select(directory => $"{directory.TrimEnd('/')}/applications")
            .Append("/var/lib/snapd/desktop/applications")
            .Distinct(StringComparer.Ordinal);
    }

    private static Dictionary<string, string> FindDesktopFiles()
    {
        var files = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var directory in ApplicationDirectories(Environment.GetEnvironmentVariable))
        {
            if (!Directory.Exists(directory))
            {
                continue;
            }

            foreach (var path in Directory.EnumerateFiles(directory, "*.desktop", SearchOption.AllDirectories))
            {
                try
                {
                    if (ParseDesktopEntryName(File.ReadAllText(path)) is { } name)
                    {
                        files.TryAdd(name, path);
                    }
                }
                catch (IOException)
                {
                    // Kaputte Verknuepfung (z. B. nach Deinstallation) - einfach auslassen.
                }
                catch (UnauthorizedAccessException)
                {
                }
            }
        }

        return files;
    }

    private static void Run(string fileName, params string[] arguments)
    {
        var startInfo = LinuxClipboardService.CreateStartInfo(
            LinuxClipboardService.GetBackendAsync().GetAwaiter().GetResult(), fileName, arguments);
        Process process;
        try
        {
            process = Process.Start(startInfo) ?? throw new InvalidOperationException($"Failed to start {fileName}.");
        }
        catch (Win32Exception)
        {
            var package = fileName == "gio" ? "libglib2.0-bin / glib2" : "xdg-utils";
            throw new NotSupportedException($"{fileName} is not installed (package \"{package}\").");
        }

        // Nicht bis zum Ende warten: xdg-open kehrt je nach Desktop erst zurueck, wenn der Browser
        // schliesst. Ein schneller Fehler (Datei nicht startbar) soll aber nicht als Erfolg gelten.
        using (process)
        {
            if (process.WaitForExit(CommandTimeoutMs) && process.ExitCode != 0)
            {
                throw new InvalidOperationException($"{fileName} exited with code {process.ExitCode}.");
            }
        }
    }
}
