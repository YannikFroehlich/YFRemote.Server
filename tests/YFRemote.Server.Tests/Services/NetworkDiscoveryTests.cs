using System.Net;
using System.Net.Sockets;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public class NetworkDiscoveryTests
{
    [TestMethod]
    public async Task Discover_FindsResponderWithItsHttpPort()
    {
        var port = FreeUdpPort();
        using var stop = new CancellationTokenSource();
        var responder = NetworkDiscovery.RespondAsync(IPAddress.Loopback, 5060, stop.Token, port);

        var found = await NetworkDiscovery.DiscoverAsync(TimeSpan.FromSeconds(1), CancellationToken.None, [IPAddress.Loopback], port);

        stop.Cancel();
        await responder;
        Assert.HasCount(1, found);
        Assert.AreEqual(new IPEndPoint(IPAddress.Loopback, 5060), found[0]);
    }

    [TestMethod]
    public async Task Responder_IgnoresOtherPayloads()
    {
        var port = FreeUdpPort();
        using var stop = new CancellationTokenSource();
        var responder = NetworkDiscovery.RespondAsync(IPAddress.Loopback, 5060, stop.Token, port);
        using var client = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0));

        await client.SendAsync("hallo"u8.ToArray(), new IPEndPoint(IPAddress.Loopback, port));
        using var wait = new CancellationTokenSource(TimeSpan.FromMilliseconds(500));
        var answered = true;
        try
        {
            await client.ReceiveAsync(wait.Token);
        }
        catch (OperationCanceledException)
        {
            answered = false;
        }

        stop.Cancel();
        await responder;
        Assert.IsFalse(answered);
    }

    [TestMethod]
    public void ParseReply_AcceptsOnlyYFRemoteWithValidPort()
    {
        Assert.AreEqual(5050, NetworkDiscovery.ParseReply(NetworkDiscovery.CreateReply(5050)));
        Assert.IsNull(NetworkDiscovery.ParseReply("""{"service":"Other","port":5050}"""u8));
        Assert.IsNull(NetworkDiscovery.ParseReply("""{"service":"YFRemote","port":0}"""u8));
        Assert.IsNull(NetworkDiscovery.ParseReply("kein json"u8));
    }

    [TestMethod]
    public void BroadcastAddress_SetsHostBits()
    {
        Assert.AreEqual(
            IPAddress.Parse("192.168.0.255"),
            NetworkAddressService.GetBroadcastAddress(IPAddress.Parse("192.168.0.24"), IPAddress.Parse("255.255.255.0")));
        Assert.AreEqual(
            IPAddress.Parse("10.0.15.255"),
            NetworkAddressService.GetBroadcastAddress(IPAddress.Parse("10.0.12.7"), IPAddress.Parse("255.255.252.0")));
    }

    private static int FreeUdpPort()
    {
        using var probe = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0));
        return ((IPEndPoint)probe.Client.LocalEndPoint!).Port;
    }
}
