using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class WindowsMouseServiceTests
{
    // Nutzt einen echten WindowsInputSender: Bei einem unbekannten Button wird die
    // ArgumentException geworfen, bevor SendInput aufgerufen wird, daher sind diese Tests
    // ohne Seiteneffekte auf die tatsächliche Maus möglich.
    [TestMethod]
    public void ButtonDown_UnsupportedButton_ThrowsArgumentException()
    {
        var mouseService = new WindowsMouseService(new WindowsInputSender());

        var exception = Assert.ThrowsExactly<ArgumentException>(() => mouseService.ButtonDown("scroll"));

        StringAssert.Contains(exception.Message, "Unsupported mouse button: scroll");
    }

    [TestMethod]
    public void ButtonUp_UnsupportedButton_ThrowsArgumentException()
    {
        var mouseService = new WindowsMouseService(new WindowsInputSender());

        var exception = Assert.ThrowsExactly<ArgumentException>(() => mouseService.ButtonUp("scroll"));

        StringAssert.Contains(exception.Message, "Unsupported mouse button: scroll");
    }
}
