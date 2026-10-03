using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace YFRemote.Server.Services;

internal static class NetworkAddressService
{
    public static string GetLocalAddress(int port, string scheme = "http")
    {
        return $"{scheme}://localhost:{port}";
    }

    public static string GetDeviceAddress(int port, string scheme = "http")
    {
        try
        {
            var address = NetworkInterface.GetAllNetworkInterfaces()
                .Where(networkInterface =>
                    networkInterface.OperationalStatus == OperationalStatus.Up &&
                    networkInterface.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .OrderByDescending(HasDefaultGateway)
                .SelectMany(networkInterface => networkInterface.GetIPProperties().UnicastAddresses)
                .Select(unicastAddress => unicastAddress.Address)
                .FirstOrDefault(IsUsableIpv4Address);

            return address is null
                ? GetLocalAddress(port, scheme)
                : $"{scheme}://{address}:{port}";
        }
        catch (NetworkInformationException)
        {
            return GetLocalAddress(port, scheme);
        }
    }

    // MAC-Adresse der Netzwerkkarte hinter GetDeviceAddress, fuer Wake-on-LAN von einem anderen
    // Geraet aus, und ob sie WLAN ist - darueber wecken die meisten PCs nicht auf. Ohne brauchbare
    // IPv4-Adresse oder MAC (z. B. nur Loopback) ist MacAddress null.
    public static (string? MacAddress, bool Wireless) GetDeviceAdapter()
    {
        try
        {
            var networkInterface = NetworkInterface.GetAllNetworkInterfaces()
                .Where(networkInterface =>
                    networkInterface.OperationalStatus == OperationalStatus.Up &&
                    networkInterface.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .OrderByDescending(HasDefaultGateway)
                .FirstOrDefault(networkInterface => networkInterface.GetIPProperties().UnicastAddresses
                    .Any(unicastAddress => IsUsableIpv4Address(unicastAddress.Address)));

            return networkInterface is null
                ? (null, false)
                : (FormatMacAddress(networkInterface.GetPhysicalAddress().GetAddressBytes()),
                    networkInterface.NetworkInterfaceType == NetworkInterfaceType.Wireless80211);
        }
        catch (NetworkInformationException)
        {
            return (null, false);
        }
    }

    internal static string? FormatMacAddress(byte[] bytes)
    {
        return bytes.Length == 6 && bytes.Any(value => value != 0)
            ? string.Join(':', bytes.Select(value => value.ToString("X2")))
            : null;
    }

    // Immer ueber HTTP: das Zertifikat muss geladen werden koennen, bevor das Geraet der
    // HTTPS-Adresse ueberhaupt vertraut.
    public static string GetCertificateUrl(int httpPort)
    {
        return new Uri(new Uri(GetDeviceAddress(httpPort)), "/ca.crt").AbsoluteUri;
    }

    // Alle LAN-Adressen, nicht nur die bevorzugte: das Serverzertifikat muss jede abdecken, ueber
    // die ein Geraet den Server erreichen kann.
    public static IReadOnlyCollection<IPAddress> GetLocalIpv4Addresses()
    {
        try
        {
            return NetworkInterface.GetAllNetworkInterfaces()
                .Where(networkInterface =>
                    networkInterface.OperationalStatus == OperationalStatus.Up &&
                    networkInterface.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .SelectMany(networkInterface => networkInterface.GetIPProperties().UnicastAddresses)
                .Select(unicastAddress => unicastAddress.Address)
                .Where(IsUsableIpv4Address)
                .Distinct()
                .ToArray();
        }
        catch (NetworkInformationException)
        {
            return [];
        }
    }

    private static bool HasDefaultGateway(NetworkInterface networkInterface)
    {
        return networkInterface.GetIPProperties().GatewayAddresses.Any(gateway =>
            !gateway.Address.Equals(IPAddress.Any) &&
            !gateway.Address.Equals(IPAddress.IPv6Any));
    }

    internal static bool IsUsableIpv4Address(IPAddress address)
    {
        if (address.AddressFamily != AddressFamily.InterNetwork || IPAddress.IsLoopback(address))
        {
            return false;
        }

        var bytes = address.GetAddressBytes();
        return bytes[0] != 169 || bytes[1] != 254;
    }
}
