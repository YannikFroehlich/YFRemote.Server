namespace YFRemote.Server.Services;

internal static class PairingQrCodePayload
{
    private const string PinFragmentParameter = "pin";
    private const string AuthorityFragmentParameter = "ca";
    private const string HttpPortFragmentParameter = "http";
    private const int StandardHttpPort = 5050;

    // caSha256: Fingerabdruck der lokalen CA bei HTTPS. Die Android-App vertraut dem Server nur, wenn
    // sein Zertifikat von genau dieser CA stammt - der QR-Code vom PC-Bildschirm ist der sichere Weg.
    // httpPort: dort holt die App bei HTTPS die CA; ohne Angabe nimmt sie den Standardport.
    public static string Create(string deviceAddress, string? pin = null, string? caSha256 = null, int? httpPort = null)
    {
        if (!Uri.TryCreate(deviceAddress, UriKind.Absolute, out var address) ||
            (address.Scheme != Uri.UriSchemeHttp && address.Scheme != Uri.UriSchemeHttps))
        {
            throw new ArgumentException("Device address must be an absolute HTTP(S) URL.", nameof(deviceAddress));
        }

        if (pin is not null && (pin.Length != 6 || !pin.All(char.IsAsciiDigit)))
        {
            throw new ArgumentException("Pairing PIN must contain exactly six digits.", nameof(pin));
        }

        if (caSha256 is not null && (caSha256.Length != 64 || !caSha256.All(char.IsAsciiHexDigitLower)))
        {
            throw new ArgumentException("CA fingerprint must be 64 lowercase hex digits.", nameof(caSha256));
        }

        string?[] parameters =
        [
            pin is null ? null : $"{PinFragmentParameter}={pin}",
            caSha256 is null ? null : $"{AuthorityFragmentParameter}={caSha256}",
            caSha256 is null || httpPort is null or StandardHttpPort ? null : $"{HttpPortFragmentParameter}={httpPort}",
        ];
        var payload = new UriBuilder(address)
        {
            Fragment = string.Join('&', parameters.OfType<string>())
        };

        return payload.Uri.AbsoluteUri;
    }
}
