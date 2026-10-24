using System.Diagnostics;

namespace YFRemote.Server.Services;

public sealed class WindowsAppLauncher : IAppLauncher
{
    private static readonly EnumerationOptions Recursive = new()
    {
        RecurseSubdirectories = true,
        IgnoreInaccessible = true
    };

    public IReadOnlyList<string> ListApps() =>
        FindShortcuts().Keys.Order(StringComparer.CurrentCultureIgnoreCase).ToList();

    public bool TryLaunchApp(string name)
    {
        if (!FindShortcuts().TryGetValue(name, out var path))
        {
            return false;
        }

        Start(path);
        return true;
    }

    public void OpenUrl(Uri url) => Start(url.AbsoluteUri);

    // Startmenue des Benutzers vor dem aller Benutzer. .url zaehlt mit, weil Steam seine Spiele so
    // ablegt (steam://rungameid/...).
    // ponytail: Store-Apps ohne Verknuepfung fehlen, die braeuchten die Aufzaehlung von shell:AppsFolder.
    private static Dictionary<string, string> FindShortcuts()
    {
        var shortcuts = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var folder in new[] { Environment.SpecialFolder.Programs, Environment.SpecialFolder.CommonPrograms })
        {
            var root = Environment.GetFolderPath(folder);
            if (root.Length == 0 || !Directory.Exists(root))
            {
                continue;
            }

            foreach (var path in Directory.EnumerateFiles(root, "*", Recursive))
            {
                if (Path.GetExtension(path).ToLowerInvariant() is ".lnk" or ".url")
                {
                    shortcuts.TryAdd(Path.GetFileNameWithoutExtension(path), path);
                }
            }
        }

        return shortcuts;
    }

    // Die Shell oeffnet Verknuepfung bzw. Adresse wie ein Doppelklick, ohne dass YFRemote selbst
    // eine Befehlszeile zusammensetzt.
    private static void Start(string target) =>
        Process.Start(new ProcessStartInfo(target) { UseShellExecute = true })?.Dispose();
}
