using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using System.Text.Json.Serialization;
using YFRemote.Server.Configuration;

namespace YFRemote.Server.Services;

// Ein Geraet, das dieser PC steuert. Url ist immer die HTTP-Adresse (fuer /health, und als
// Schluessel). Named: der Nutzer hat den Namen selbst vergeben; sonst uebernimmt die App den per
// /health gemeldeten Geraetenamen - wie RemoteDevice auf Android. Ca: die beim ersten Kontakt
// geladene lokale CA des Geraets (DER, Base64), HttpsPort: sein HTTPS-Port laut /health. Mit
// beidem oeffnet das Geraetefenster https und vertraut nur Zertifikaten dieser CA.
internal sealed record RemoteDevice(string Url, string Name, bool Named = false, string? Ca = null, int? HttpsPort = null)
{
    [JsonIgnore]
    public string Address => new Uri(Url).Authority;

    [JsonIgnore]
    public bool Secure => Ca is not null && HttpsPort is not null;

    [JsonIgnore]
    public string OpenUrl => Secure ? $"https://{new Uri(Url).Host}:{HttpsPort}" : Url;
}

internal static class PinnedCertificate
{
    // Das Serverzertifikat muss von genau der gemerkten CA stammen, noch gueltig sein und den
    // Host (die LAN-IP) abdecken - wie PinnedCa.issued in der Android-App.
    public static bool IsIssuedBy(X509Certificate2 serverCertificate, X509Certificate2 authority, string host)
    {
        using var chain = new X509Chain();
        chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        chain.ChainPolicy.CustomTrustStore.Add(authority);
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        return chain.Build(serverCertificate)
            && chain.ChainElements[^1].Certificate.RawData.AsSpan().SequenceEqual(authority.RawData)
            && serverCertificate.MatchesHostname(host);
    }

    // Nur ein CA-Zertifikat wird gemerkt - ein Leaf als "CA" liesse sich sonst als eigene Wurzel nutzen.
    public static string? ToPinnedAuthority(byte[] der)
    {
        try
        {
            using var certificate = X509CertificateLoader.LoadCertificate(der);
            return certificate.Extensions.OfType<X509BasicConstraintsExtension>().Any(constraints => constraints.CertificateAuthority)
                ? Convert.ToBase64String(certificate.RawData)
                : null;
        }
        catch (System.Security.Cryptography.CryptographicException)
        {
            return null;
        }
    }
}

// Die Liste der Geraete unter "Steuern". Das Pairing-Token verwaltet der Web-Client selbst im
// localStorage des WebView2, pro Origin wie im Browser - hier steht nur die Adresse.
internal sealed class RemoteDeviceStore(string filePath)
{
    public const int DefaultPort = 5050;

    public static string DefaultFilePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "YFRemote", "remote-devices.json");

    public IReadOnlyList<RemoteDevice> Load()
    {
        try
        {
            return File.Exists(filePath)
                ? JsonSerializer.Deserialize<List<RemoteDevice>>(File.ReadAllBytes(filePath), JsonSerializerOptions.Web) ?? []
                : [];
        }
        catch (Exception exception) when (exception is JsonException or IOException)
        {
            // Eine kaputte Liste kostet nur die gemerkten Adressen, die Tokens liegen im WebView2.
            return [];
        }
    }

    public void Add(RemoteDevice device) => Save([.. Load().Where(existing => existing.Url != device.Url), device]);

    public void Remove(string url) => Save([.. Load().Where(device => device.Url != url)]);

    // Leerer Name: wieder automatisch; bis /health antwortet, gilt die Adresse.
    public void Rename(string url, string name) => Save([.. Load().Select(device =>
        device.Url != url ? device
        : string.IsNullOrWhiteSpace(name) ? device with { Name = device.Address, Named = false }
        : device with { Name = name.Trim(), Named = true })]);

    // Ersetzt nur einen Namen, den der Nutzer nicht selbst vergeben hat.
    public void SetReportedName(string url, string name)
    {
        var devices = Load();
        if (devices.Any(device => device.Url == url && !device.Named && device.Name != name))
        {
            Save([.. devices.Select(device => device.Url == url && !device.Named ? device with { Name = name } : device)]);
        }
    }

    // Merkt CA und HTTPS-Port; ca null laesst eine schon gemerkte CA stehen (das Geraet hat HTTPS
    // nur gerade aus, httpsPort null). Eine andere CA ersetzt die gemerkte nie - dafuer wird das
    // Geraet entfernt und neu hinzugefuegt.
    public void SetHttps(string url, string? ca, int? httpsPort)
    {
        var devices = Load();
        var updated = devices.Select(device => device.Url != url ? device
            : device with { Ca = device.Ca ?? ca, HttpsPort = httpsPort }).ToList();
        if (!updated.SequenceEqual(devices))
        {
            Save(updated);
        }
    }

    private void Save(IReadOnlyList<RemoteDevice> devices) =>
        UserSettingsStore.WriteAtomically(filePath, JsonSerializer.SerializeToUtf8Bytes(devices, JsonSerializerOptions.Web));

    // "192.168.0.5", "pc.local:5060" oder "http://..." -> "http://host:port", sonst null.
    public static string? NormalizeAddress(string input)
    {
        var address = input.Trim();
        if (address.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
        {
            address = address["http://".Length..];
        }

        address = address.TrimEnd('/');
        if (address.Length == 0 || address.Contains("://") || address.Contains('/'))
        {
            return null;
        }

        var separator = address.IndexOf(':');
        var host = separator < 0 ? address : address[..separator];
        var port = DefaultPort;
        if ((separator >= 0 && !int.TryParse(address[(separator + 1)..], out port))
            || port is < 1 or > 65535
            || host.Length == 0
            || host.Any(char.IsWhiteSpace))
        {
            return null;
        }

        return $"http://{host.ToLowerInvariant()}:{port}";
    }
}
