using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

// Nur die Stilregel: Aufzaehlen und Fokussieren brauchen echte Fenster - am 2026-10-24 auf dem
// Entwicklungs-PC von Hand geprueft.
[TestClass]
public sealed class WindowsWindowServiceTests
{
    [TestMethod]
    [DataRow(0x280100L, true)]      // normales Anwendungsfenster (Claude)
    [DataRow(0x8080028L, false)]    // Parsecs 1x1-Overlay: WS_EX_NOACTIVATE
    [DataRow(0x8040000L, true)]     // nicht aktivierbar, aber WS_EX_APPWINDOW
    [DataRow(0x80L, false)]         // WS_EX_TOOLWINDOW
    public void IsAltTabStyle_FollowsAltTab(long extendedStyle, bool shown)
    {
        Assert.AreEqual(shown, WindowsWindowService.IsAltTabStyle(extendedStyle));
    }
}
