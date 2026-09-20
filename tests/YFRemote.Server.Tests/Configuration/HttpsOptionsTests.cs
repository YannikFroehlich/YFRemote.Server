using YFRemote.Server.Configuration;

namespace YFRemote.Server.Tests.Configuration;

[TestClass]
public sealed class HttpsOptionsTests
{
    [TestMethod]
    public void Validate_DefaultOptions_DoesNotThrow()
    {
        new HttpsOptions().Validate();
    }

    [TestMethod]
    public void Default_IsDisabled()
    {
        Assert.IsFalse(new HttpsOptions().Enabled);
    }

    [TestMethod]
    [DataRow(0)]
    [DataRow(-1)]
    [DataRow(65536)]
    public void Validate_PortOutOfRange_ThrowsInvalidOperationException(int port)
    {
        var options = new HttpsOptions { Port = port };

        var exception = Assert.ThrowsExactly<InvalidOperationException>(options.Validate);

        StringAssert.Contains(exception.Message, "Https:Port");
    }

    [TestMethod]
    [DataRow("")]
    [DataRow("   ")]
    public void Validate_BlankCertificateAuthorityPath_ThrowsInvalidOperationException(string path)
    {
        var options = new HttpsOptions { CertificateAuthorityPath = path };

        var exception = Assert.ThrowsExactly<InvalidOperationException>(options.Validate);

        StringAssert.Contains(exception.Message, "Https:CertificateAuthorityPath");
    }
}
