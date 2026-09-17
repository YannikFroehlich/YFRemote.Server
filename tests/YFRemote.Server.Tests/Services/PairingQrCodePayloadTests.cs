using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

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
}
