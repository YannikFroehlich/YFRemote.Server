using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

// Nutzt einen echten LinuxInputSender: Bei einem unbekannten Button wird die
// ArgumentException geworfen, bevor irgendein /dev/uinput-Geraet angelegt wird, daher sind
// diese Tests ohne Linux-Kernel moeglich.
[TestClass]
public sealed class LinuxMouseServiceTests
{
    [TestMethod]
    public void ButtonDown_UnsupportedButton_ThrowsArgumentException()
    {
        var mouseService = new LinuxMouseService(new LinuxInputSender());

        var exception = Assert.ThrowsExactly<ArgumentException>(() => mouseService.ButtonDown("scroll"));

        StringAssert.Contains(exception.Message, "Unsupported mouse button: scroll");
    }

    [TestMethod]
    public void ButtonUp_UnsupportedButton_ThrowsArgumentException()
    {
        var mouseService = new LinuxMouseService(new LinuxInputSender());

        var exception = Assert.ThrowsExactly<ArgumentException>(() => mouseService.ButtonUp("scroll"));

        StringAssert.Contains(exception.Message, "Unsupported mouse button: scroll");
    }
}
