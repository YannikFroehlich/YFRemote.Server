using System.Net;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using YFRemote.Server.Configuration;

namespace YFRemote.Server.Services;

internal sealed class ServerCertificateProvider : IDisposable
{
    private readonly HttpsOptions options;
    private readonly TimeProvider timeProvider;
    private readonly Lock gate = new();

    private X509Certificate2? authority;
    private X509Certificate2? serverCertificate;
    private bool disposed;

    public ServerCertificateProvider(HttpsOptions options, TimeProvider timeProvider)
    {
        this.options = options;
        this.timeProvider = timeProvider;

        // Statt periodisch zu pruefen, ob die LAN-Adresse noch zum Zertifikat passt: bei jedem
        // Adresswechsel wird das Leaf verworfen und beim naechsten Handshake neu ausgestellt.
        NetworkChange.NetworkAddressChanged += OnNetworkAddressChanged;
    }

    public X509Certificate2 GetServerCertificate()
    {
        lock (gate)
        {
            var now = timeProvider.GetUtcNow();

            if (serverCertificate is null || serverCertificate.NotAfter.ToUniversalTime() <= now.AddDays(1).UtcDateTime)
            {
                serverCertificate = LocalCertificateAuthority.IssueServerCertificate(
                    EnsureAuthority(),
                    NetworkAddressService.GetLocalIpv4Addresses(),
                    now);
            }

            return serverCertificate;
        }
    }

    public byte[] ExportAuthorityCertificate()
    {
        lock (gate)
        {
            return EnsureAuthority().Export(X509ContentType.Cert);
        }
    }

    public void Dispose()
    {
        if (disposed)
        {
            return;
        }

        disposed = true;
        NetworkChange.NetworkAddressChanged -= OnNetworkAddressChanged;

        lock (gate)
        {
            authority?.Dispose();
            authority = null;
            serverCertificate = null;
        }
    }

    private X509Certificate2 EnsureAuthority()
    {
        return authority ??= File.Exists(options.CertificateAuthorityPath)
            ? LoadAuthority()
            : CreateAuthority();
    }

    private X509Certificate2 LoadAuthority()
    {
        try
        {
            return X509CertificateLoader.LoadPkcs12(
                Unprotect(File.ReadAllBytes(options.CertificateAuthorityPath)),
                null,
                X509KeyStorageFlags.Exportable);
        }
        catch (Exception exception) when (exception is CryptographicException or IOException)
        {
            // Bewusst kein Neuerzeugen: eine neue CA wuerde jedes Geraet, das die alte installiert
            // hat, still auf eine Zertifikatswarnung laufen lassen. Die Datei muss von Hand weg.
            throw new InvalidOperationException(
                $"Die lokale Zertifizierungsstelle '{options.CertificateAuthorityPath}' konnte nicht gelesen werden. " +
                "Datei loeschen, um eine neue zu erzeugen - alle gekoppelten Geraete muessen das neue Zertifikat dann erneut installieren.",
                exception);
        }
    }

    private X509Certificate2 CreateAuthority()
    {
        var created = LocalCertificateAuthority.CreateAuthority(timeProvider.GetUtcNow());

        var directory = Path.GetDirectoryName(options.CertificateAuthorityPath);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        Write(options.CertificateAuthorityPath, created.Export(X509ContentType.Pkcs12));
        return created;
    }

    private void OnNetworkAddressChanged(object? sender, EventArgs eventArgs)
    {
        lock (gate)
        {
            // Nicht disposen: ein gerade laufender TLS-Handshake haelt das Zertifikat noch.
            serverCertificate = null;
        }
    }

    private static void Write(string path, byte[] pkcs12)
    {
#if WINDOWS
        // Der CA-Schluessel ist ein Generalschluessel fuer jedes Geraet, das die CA installiert
        // hat. DPAPI bindet ihn an das Windows-Benutzerkonto, damit eine Kopie der Datei allein
        // - aus einem Backup oder einem anderen Konto - nichts nuetzt.
        File.WriteAllBytes(path, ProtectedData.Protect(pkcs12, null, DataProtectionScope.CurrentUser));
#else
        if (!OperatingSystem.IsWindows())
        {
            // Unter Linux uebernehmen die Dateirechte diese Aufgabe: nur der eigene Benutzer liest.
            using var stream = new FileStream(path, new FileStreamOptions
            {
                Mode = FileMode.Create,
                Access = FileAccess.Write,
                UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite
            });

            stream.Write(pkcs12);
            return;
        }

        // Nur das portable net10.0-Ziel auf Windows, das es als Release nicht gibt: ohne DPAPI
        // bleibt hier nur die Zugriffskontrolle des Benutzerprofils.
        File.WriteAllBytes(path, pkcs12);
#endif
    }

    private static byte[] Unprotect(byte[] stored)
    {
#if WINDOWS
        return ProtectedData.Unprotect(stored, null, DataProtectionScope.CurrentUser);
#else
        return stored;
#endif
    }
}
