using System.Text.Json;
using System.Text.Json.Serialization;
using YFRemote.Server.Configuration;

namespace YFRemote.Server.Services;

// Ein Geraet, das dieser PC steuert. Named: der Nutzer hat den Namen selbst vergeben; sonst
// uebernimmt die App den per /health gemeldeten Geraetenamen - wie RemoteDevice auf Android.
internal sealed record RemoteDevice(string Url, string Name, bool Named = false)
{
    [JsonIgnore]
    public string Address => new Uri(Url).Authority;
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
