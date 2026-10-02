using System.Net;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

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
    public void FormatMacAddress_SixBytes_ReturnsColonSeparatedUpperHex()
    {
        Assert.AreEqual(
            "00:1A:2B:3C:4D:5E",
            NetworkAddressService.FormatMacAddress([0x00, 0x1A, 0x2B, 0x3C, 0x4D, 0x5E]));
    }

    [TestMethod]
    public void FormatMacAddress_EmptyOrAllZero_ReturnsNull()
    {
        Assert.IsNull(NetworkAddressService.FormatMacAddress([]));
        Assert.IsNull(NetworkAddressService.FormatMacAddress(new byte[6]));
    }

    [TestMethod]
    public void IsUsableIpv4Address_Ipv6Address_ReturnsFalse()
    {
        Assert.IsFalse(NetworkAddressService.IsUsableIpv4Address(IPAddress.Parse("::1")));
    }

    [TestMethod]
    public void GetCertificateUrl_UsesHttpAndTheGivenPort()
    {
        var url = NetworkAddressService.GetCertificateUrl(5050);

        StringAssert.StartsWith(url, "http://");
        StringAssert.EndsWith(url, ":5050/ca.crt");
    }
}
