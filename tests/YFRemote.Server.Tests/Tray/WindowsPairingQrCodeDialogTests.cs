using YFRemote.Server.Tray;

namespace YFRemote.Server.Tests.Tray;

[TestClass]
public sealed class WindowsPairingQrCodeDialogTests
{
    [TestMethod]
    public void CreateQrCodeImage_ValidPayload_ReturnsBitmap()
    {
        using var image = PairingQrCodeDialog.CreateQrCodeImage(
            "http://192.168.1.42:5050/#pin=123456");

        Assert.IsGreaterThan(0, image.Width);
        Assert.IsGreaterThan(0, image.Height);
    }
}
