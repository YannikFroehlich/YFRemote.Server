using YFRemote.Server.Tray;

namespace YFRemote.Server.Tests.Tray;

[TestClass]
public sealed class PairingQrCodePayloadTests
{
    [TestMethod]
    public void Create_WithoutPin_ReturnsDeviceAddress()
    {
        var payload = PairingQrCodePayload.Create("http://192.168.1.42:5050");

        Assert.AreEqual("http://192.168.1.42:5050/", payload);
    }

    [TestMethod]
    public void Create_WithPin_StoresPinInFragment()
    {
        var payload = PairingQrCodePayload.Create("http://192.168.1.42:5050", "123456");

        Assert.AreEqual("http://192.168.1.42:5050/#pin=123456", payload);
    }

    [TestMethod]
    public void Create_WithInvalidPin_Throws()
    {
        Assert.ThrowsExactly<ArgumentException>(() =>
            PairingQrCodePayload.Create("http://192.168.1.42:5050", "123"));
    }

    [TestMethod]
    public void CreateQrCodeImage_ValidPayload_ReturnsBitmap()
    {
        using var image = PairingQrCodeDialog.CreateQrCodeImage(
            "http://192.168.1.42:5050/#pin=123456");

        Assert.IsGreaterThan(0, image.Width);
        Assert.IsGreaterThan(0, image.Height);
    }
}
