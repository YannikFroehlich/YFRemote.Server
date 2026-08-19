using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace YFRemote.Server.Tray;

internal static class NetworkAddressService
{
    public static string GetLocalAddress(int port)
    {
        return $"http://localhost:{port}";
    }

    public static string GetDeviceAddress(int port)
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
                ? GetLocalAddress(port)
                : $"http://{address}:{port}";
        }
        catch (NetworkInformationException)
        {
            return GetLocalAddress(port);
        }
    }

    private static bool HasDefaultGateway(NetworkInterface networkInterface)
    {
        return networkInterface.GetIPProperties().GatewayAddresses.Any(gateway =>
            !gateway.Address.Equals(IPAddress.Any) &&
            !gateway.Address.Equals(IPAddress.IPv6Any));
    }

    private static bool IsUsableIpv4Address(IPAddress address)
    {
        if (address.AddressFamily != AddressFamily.InterNetwork || IPAddress.IsLoopback(address))
        {
            return false;
        }

        var bytes = address.GetAddressBytes();
        return bytes[0] != 169 || bytes[1] != 254;
    }
}
