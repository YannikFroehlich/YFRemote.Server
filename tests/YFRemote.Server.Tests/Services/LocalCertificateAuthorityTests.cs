using System.Net;
using System.Security.Cryptography.X509Certificates;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class LocalCertificateAuthorityTests
{
    private const string SubjectAlternativeNameOid = "2.5.29.17";

    [TestMethod]
    public void CreateAuthority_CanSignAndIsMarkedAsAuthority()
    {
        using var authority = LocalCertificateAuthority.CreateAuthority(DateTimeOffset.UtcNow);

        Assert.IsTrue(authority.HasPrivateKey);

        var basicConstraints = authority.Extensions.OfType<X509BasicConstraintsExtension>().Single();
        Assert.IsTrue(basicConstraints.CertificateAuthority);

        var keyUsage = authority.Extensions.OfType<X509KeyUsageExtension>().Single();
        Assert.IsTrue(keyUsage.KeyUsages.HasFlag(X509KeyUsageFlags.KeyCertSign));
    }

    [TestMethod]
    public void IssueServerCertificate_CoversGivenAndLoopbackAddress()
    {
        using var authority = LocalCertificateAuthority.CreateAuthority(DateTimeOffset.UtcNow);
        using var certificate = LocalCertificateAuthority.IssueServerCertificate(
            authority,
            [IPAddress.Parse("192.168.178.42")],
            DateTimeOffset.UtcNow);

        Assert.IsTrue(certificate.HasPrivateKey);
        Assert.AreEqual(authority.Subject, certificate.Issuer);

        var addresses = ReadSubjectAlternativeNames(certificate)
            .EnumerateIPAddresses()
            .Select(address => address.ToString())
            .ToArray();

        CollectionAssert.Contains(addresses, "192.168.178.42");
        CollectionAssert.Contains(addresses, "127.0.0.1");
        CollectionAssert.Contains(
            ReadSubjectAlternativeNames(certificate).EnumerateDnsNames().ToArray(),
            "localhost");
    }

    [TestMethod]
    public void IssueServerCertificate_ChainsToTheAuthority()
    {
        using var authority = LocalCertificateAuthority.CreateAuthority(DateTimeOffset.UtcNow);
        using var certificate = LocalCertificateAuthority.IssueServerCertificate(
            authority,
            [IPAddress.Parse("192.168.178.42")],
            DateTimeOffset.UtcNow);

        using var chain = new X509Chain();
        chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        chain.ChainPolicy.CustomTrustStore.Add(authority);
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;

        Assert.IsTrue(
            chain.Build(certificate),
            string.Join(", ", chain.ChainStatus.Select(status => status.StatusInformation.Trim())));
    }

    [TestMethod]
    public void IssueServerCertificate_StaysBelowTheBrowserLifetimeLimit()
    {
        var now = DateTimeOffset.UtcNow;

        using var authority = LocalCertificateAuthority.CreateAuthority(now);
        using var certificate = LocalCertificateAuthority.IssueServerCertificate(
            authority,
            [IPAddress.Parse("192.168.178.42")],
            now);

        var lifetime = certificate.NotAfter.ToUniversalTime() - certificate.NotBefore.ToUniversalTime();

        Assert.IsTrue(lifetime < TimeSpan.FromDays(398), $"Laufzeit: {lifetime}");
    }

    private static X509SubjectAlternativeNameExtension ReadSubjectAlternativeNames(
        X509Certificate2 certificate)
    {
        var extension = certificate.Extensions[SubjectAlternativeNameOid];
        Assert.IsNotNull(extension);
        return new X509SubjectAlternativeNameExtension(extension.RawData, extension.Critical);
    }
}
