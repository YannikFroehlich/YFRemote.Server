using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

// Der Testprozess läuft nicht aus einem installierten Velopack-"current"-Verzeichnis, daher
// deckt diese Klasse nur die Pfade ab, die vor jedem Registry-Zugriff greifen. Ein Test von
// SetEnabled(true)-im-installierten-Fall oder SetEnabled(false) würde den echten
// HKCU-Autostart-Eintrag der ausführenden Maschine verändern und wird deshalb bewusst
// ausgelassen.
[TestClass]
public sealed class WindowsStartupServiceTests
{
    [TestMethod]
    public void IsAvailable_WhenNotRunningFromInstalledCurrentDirectory_ReturnsFalse()
    {
        Assert.IsFalse(WindowsStartupService.IsAvailable);
    }

    [TestMethod]
    public void IsEnabled_WhenNotAvailable_ReturnsFalse()
    {
        Assert.IsFalse(WindowsStartupService.IsEnabled());
    }

    [TestMethod]
    public void SetEnabled_True_WhenNotAvailable_ThrowsInvalidOperationException()
    {
        Assert.ThrowsExactly<InvalidOperationException>(() => WindowsStartupService.SetEnabled(true));
    }
}
