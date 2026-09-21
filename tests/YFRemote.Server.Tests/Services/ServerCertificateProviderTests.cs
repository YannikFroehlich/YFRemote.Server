using YFRemote.Server.Configuration;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class ServerCertificateProviderTests
{
    [TestMethod]
    public void GetServerCertificate_ReturnsCertificateWithPrivateKey()
    {
        var path = CreateTemporaryPath();

        try
        {
            using var provider = new ServerCertificateProvider(CreateOptions(path), TimeProvider.System);

            Assert.IsTrue(provider.GetServerCertificate().HasPrivateKey);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [TestMethod]
    public void ExportAuthorityCertificate_SecondInstance_ReusesTheStoredAuthority()
    {
        var path = CreateTemporaryPath();

        try
        {
            var options = CreateOptions(path);
            byte[] first;

            using (var provider = new ServerCertificateProvider(options, TimeProvider.System))
            {
                first = provider.ExportAuthorityCertificate();
            }

            Assert.IsTrue(File.Exists(path));

            using var reopened = new ServerCertificateProvider(options, TimeProvider.System);

            CollectionAssert.AreEqual(first, reopened.ExportAuthorityCertificate());
        }
        finally
        {
            File.Delete(path);
        }
    }

    [TestMethod]
    public void ExportAuthorityCertificate_DamagedFile_ThrowsInsteadOfReplacingTheAuthority()
    {
        var path = CreateTemporaryPath();

        try
        {
            File.WriteAllBytes(path, [0x00, 0x01, 0x02, 0x03]);

            using var provider = new ServerCertificateProvider(CreateOptions(path), TimeProvider.System);

            var exception = Assert.ThrowsExactly<InvalidOperationException>(
                () => provider.ExportAuthorityCertificate());

            StringAssert.Contains(exception.Message, path);
        }
        finally
        {
            File.Delete(path);
        }
    }

    private static HttpsOptions CreateOptions(string path)
    {
        return new HttpsOptions { Enabled = true, CertificateAuthorityPath = path };
    }

    private static string CreateTemporaryPath()
    {
        return Path.Combine(Path.GetTempPath(), $"yfremote-ca-{Guid.NewGuid():N}.pfx");
    }
}
