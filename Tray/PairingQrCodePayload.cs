namespace YFRemote.Server.Tray;

internal static class PairingQrCodePayload
{
    private const string PinFragmentParameter = "pin";

    public static string Create(string deviceAddress, string? pin = null)
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

        var payload = new UriBuilder(address)
        {
            Fragment = pin is null
                ? string.Empty
                : $"{PinFragmentParameter}={Uri.EscapeDataString(pin)}"
        };

        return payload.Uri.AbsoluteUri;
    }
}
