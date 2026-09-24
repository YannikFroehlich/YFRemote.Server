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

    // Windows rechnet absolute Koordinaten per (Wert * Groesse) / 65536 zurueck. Jede Pixelposition
    // muss nach dem Hin- und Rueckweg wieder genau dieselbe sein, sonst driftet der Zeiger bei
    // vielen kleinen Bewegungen um ein Pixel pro Schritt ab.
    [TestMethod]
    [DataRow(1)]
    [DataRow(864)]
    [DataRow(1080)]
    [DataRow(1920)]
    [DataRow(3840)]
    [DataRow(7680)]
    public void ToAbsoluteCoordinate_RoundTripsEveryPixel(int size)
    {
        for (var offset = 0; offset < size; offset++)
        {
            var absolute = WindowsMouseService.ToAbsoluteCoordinate(offset, size);

            Assert.IsTrue(absolute is >= 0 and <= 65535, $"offset {offset}: {absolute} outside 0..65535");
            Assert.AreEqual(offset, (int)((long)absolute * size / 65536), $"offset {offset} of {size}");
        }
    }
}
