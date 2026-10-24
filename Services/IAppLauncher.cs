namespace YFRemote.Server.Services;

public interface IAppLauncher
{
    // Namen wie im Startmenue bzw. in den .desktop-Dateien, sortiert und ohne Doppelte.
    IReadOnlyList<string> ListApps();

    // false, wenn kein Eintrag so heisst (Gross-/Kleinschreibung egal).
    bool TryLaunchApp(string name);

    void OpenUrl(Uri url);
}
