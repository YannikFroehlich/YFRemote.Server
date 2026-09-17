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
    public void SupportsKey_MediaKey_ReturnsTrue(string key)
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
