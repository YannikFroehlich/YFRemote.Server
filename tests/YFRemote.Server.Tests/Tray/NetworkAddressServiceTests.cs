using System.Net;
using YFRemote.Server.Tray;

namespace YFRemote.Server.Tests.Tray;

[TestClass]
public sealed class NetworkAddressServiceTests
{
    [TestMethod]
    public void GetLocalAddress_ReturnsLocalhostWithPort()
    {
        Assert.AreEqual("http://localhost:5050", NetworkAddressService.GetLocalAddress(5050));
    }

    [TestMethod]
    public void GetDeviceAddress_ReturnsHttpUrlContainingPort()
    {
        var address = NetworkAddressService.GetDeviceAddress(5050);

        StringAssert.StartsWith(address, "http://");
        StringAssert.EndsWith(address, ":5050");
    }

    [TestMethod]
    [DataRow("192.168.1.10", true)]
    [DataRow("10.0.0.5", true)]
    [DataRow("127.0.0.1", false)]
    [DataRow("169.254.1.1", false)]
    public void IsUsableIpv4Address_Ipv4Address_ReturnsExpectedResult(string address, bool expected)
    {
        Assert.AreEqual(expected, NetworkAddressService.IsUsableIpv4Address(IPAddress.Parse(address)));
    }

    [TestMethod]
    public void IsUsableIpv4Address_Ipv6Address_ReturnsFalse()
    {
        Assert.IsFalse(NetworkAddressService.IsUsableIpv4Address(IPAddress.Parse("::1")));
    }
}
