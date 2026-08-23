using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class WindowsInputServiceTests
{
    [TestMethod]
    [DataRow("MEDIA_PLAY_PAUSE")]
    [DataRow("VOLUME_DOWN")]
    [DataRow("VOLUME_UP")]
    [DataRow("VOLUME_MUTE")]
    public void SupportsKey_MediaKey_ReturnsTrue(string key)
    {
        Assert.IsTrue(WindowsInputService.SupportsKey(key));
    }
}
