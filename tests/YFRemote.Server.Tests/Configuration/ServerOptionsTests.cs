using YFRemote.Server.Configuration;

namespace YFRemote.Server.Tests.Configuration;

[TestClass]
public sealed class ServerOptionsTests
{
    [TestMethod]
    public void Validate_DefaultOptions_DoesNotThrow()
    {
        new ServerOptions().Validate();
    }

    [TestMethod]
    [DataRow("")]
    [DataRow("   ")]
    public void Validate_BlankHost_ThrowsInvalidOperationException(string host)
    {
        var options = new ServerOptions { Host = host };

        var exception = Assert.ThrowsExactly<InvalidOperationException>(options.Validate);

        StringAssert.Contains(exception.Message, "Server:Host");
    }

    [TestMethod]
    [DataRow(0)]
    [DataRow(-1)]
    [DataRow(65536)]
    public void Validate_PortOutOfRange_ThrowsInvalidOperationException(int port)
    {
        var options = new ServerOptions { Port = port };

        var exception = Assert.ThrowsExactly<InvalidOperationException>(options.Validate);

        StringAssert.Contains(exception.Message, "Server:Port");
    }

    [TestMethod]
    [DataRow(1)]
    [DataRow(65535)]
    public void Validate_PortAtBoundary_DoesNotThrow(int port)
    {
        new ServerOptions { Port = port }.Validate();
    }
}
