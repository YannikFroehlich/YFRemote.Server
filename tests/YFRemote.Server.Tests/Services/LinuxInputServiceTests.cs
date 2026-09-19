using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class LinuxInputServiceTests
{
    [TestMethod]
    [DataRow("MEDIA_PLAY_PAUSE")]
    [DataRow("VOLUME_DOWN")]
    [DataRow("VOLUME_UP")]
    [DataRow("VOLUME_MUTE")]
    [DataRow("MEDIA_NEXT")]
    [DataRow("MEDIA_PREVIOUS")]
    [DataRow("MEDIA_STOP")]
    [DataRow("HOME")]
    [DataRow("END")]
    [DataRow("PAGE_UP")]
    [DataRow("PAGE_DOWN")]
    [DataRow("PRINT_SCREEN")]
    public void SupportsKey_MediaAndNavigationKey_ReturnsTrue(string key)
    {
        Assert.IsTrue(LinuxInputService.SupportsKey(key));
    }

    // Wirft vor jedem Geraetezugriff (siehe LinuxInputSender-Klassenkommentar), daher ohne
    // echtes /dev/uinput testbar.
    [TestMethod]
    public void PressKey_UnsupportedKey_ThrowsWithoutTouchingDevice()
    {
        var inputService = new LinuxInputService(new LinuxInputSender());

        Assert.ThrowsExactly<UnsupportedKeyException>(() => inputService.PressKey("NOT_A_KEY"));
    }
}
