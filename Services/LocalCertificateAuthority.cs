using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace YFRemote.Server.Services;

internal static class LocalCertificateAuthority
{
    private const string AuthoritySubject = "CN=YFRemote Local CA, O=YFRemote";

    private static readonly Oid ServerAuthenticationOid = new("1.3.6.1.5.5.7.3.1");

    private static readonly TimeSpan AuthorityLifetime = TimeSpan.FromDays(3650);

    // Apple und Chrome lehnen Serverzertifikate mit mehr als 398 Tagen Laufzeit ab. Die Ausnahme
    // fuer lokal installierte Wurzeln ist nicht auf jeder Plattform zugesichert, deshalb bleibt
    // das Leaf darunter - der Server stellt es ohnehin selbst neu aus.
    private static readonly TimeSpan ServerCertificateLifetime = TimeSpan.FromDays(397);

    public static X509Certificate2 CreateAuthority(DateTimeOffset now)
    {
        using var key = RSA.Create(2048);
        var request = new CertificateRequest(
            AuthoritySubject,
            key,
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);

        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, true, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(
            X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign,
            true));
        request.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(request.PublicKey, false));

        using var certificate = request.CreateSelfSigned(now.AddHours(-1), now.Add(AuthorityLifetime));
        return Reload(certificate);
    }

    public static X509Certificate2 IssueServerCertificate(
        X509Certificate2 authority,
        IReadOnlyCollection<IPAddress> addresses,
        DateTimeOffset now)
    {
        using var key = RSA.Create(2048);
        var request = new CertificateRequest(
            "CN=YFRemote",
            key,
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);

        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(
            X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment,
            true));
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension([ServerAuthenticationOid], false));
        request.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(request.PublicKey, false));
        request.CertificateExtensions.Add(
            X509AuthorityKeyIdentifierExtension.CreateFromCertificate(authority, true, false));
        request.CertificateExtensions.Add(BuildSubjectAlternativeNames(addresses));

        var serialNumber = RandomNumberGenerator.GetBytes(16);
        serialNumber[0] &= 0x7F;

        using var certificate = request.Create(
            authority,
            now.AddHours(-1),
            now.Add(ServerCertificateLifetime),
            serialNumber);

        using var withPrivateKey = certificate.CopyWithPrivateKey(key);
        return Reload(withPrivateKey);
    }

    private static X509Extension BuildSubjectAlternativeNames(IReadOnlyCollection<IPAddress> addresses)
    {
        var builder = new SubjectAlternativeNameBuilder();

        // Nur localhost und IP-Adressen: ein Geraetename darf Umlaute enthalten, die als DNS-Name
        // im Zertifikat nicht darstellbar sind.
        builder.AddDnsName("localhost");
        builder.AddIpAddress(IPAddress.Loopback);

        foreach (var address in addresses)
        {
            builder.AddIpAddress(address);
        }

        return builder.Build();
    }

    // SChannel unter Windows kann kein Serverzertifikat verwenden, dessen Schluessel nur im
    // Speicher der erzeugenden RSA-Instanz haengt. Der Umweg ueber PKCS#12 loest das Zertifikat
    // davon los und macht es zugleich speicherbar.
    private static X509Certificate2 Reload(X509Certificate2 certificate)
    {
        return X509CertificateLoader.LoadPkcs12(
            certificate.Export(X509ContentType.Pkcs12),
            null,
            X509KeyStorageFlags.Exportable);
    }
}
