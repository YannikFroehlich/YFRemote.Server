using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

// Deckt nur das Lesen der .desktop-Dateien und die Suchordner ab: Das Starten ruft gio bzw. xdg-open
// in einer echten grafischen Sitzung auf - dafuer siehe AGENTS.md "Linux support".
[TestClass]
public sealed class LinuxAppLauncherTests
{
    [TestMethod]
    public void ParseDesktopEntryName_ReadsVisibleApplication()
    {
        const string content = """
            [Desktop Entry]
            Type=Application
            Name=Firefox
            Name[de]=Firefox-Webbrowser
            Exec=firefox %u

            [Desktop Action new-window]
            Name=Neues Fenster
            """;

        Assert.AreEqual("Firefox", LinuxAppLauncher.ParseDesktopEntryName(content));
    }

    [TestMethod]
    [DataRow("[Desktop Entry]\nType=Application\nName=Hidden\nNoDisplay=true")]
    [DataRow("[Desktop Entry]\nType=Application\nName=Removed\nHidden=true")]
    [DataRow("[Desktop Entry]\nType=Link\nName=Website")]
    [DataRow("[Desktop Entry]\nType=Application")]
    [DataRow("[Other]\nType=Application\nName=Elsewhere")]
    public void ParseDesktopEntryName_SkipsEverythingElse(string content)
    {
        Assert.IsNull(LinuxAppLauncher.ParseDesktopEntryName(content));
    }

    [TestMethod]
    public void ApplicationDirectories_DefaultsFollowXdgAndAddFlatpakAndSnap()
    {
        var environment = new Dictionary<string, string> { ["HOME"] = "/home/user" };

        var directories = LinuxAppLauncher.ApplicationDirectories(environment.GetValueOrDefault).ToList();

        CollectionAssert.AreEqual(
            new[]
            {
                "/home/user/.local/share/applications",
                "/usr/local/share/applications",
                "/usr/share/applications",
                "/home/user/.local/share/flatpak/exports/share/applications",
                "/var/lib/flatpak/exports/share/applications",
                "/var/lib/snapd/desktop/applications"
            },
            directories);
    }
}
