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
