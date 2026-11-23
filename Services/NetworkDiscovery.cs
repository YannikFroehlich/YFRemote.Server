using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using YFRemote.Server.Configuration;

namespace YFRemote.Server.Services;

// Findet YFRemote-Geraete im LAN per UDP-Broadcast. Dasselbe Protokoll spricht die Android-App
// (android/.../remote/Discovery.kt): Anfrage ist der feste Text, Antwort nur der HTTP-Port -
// Name, Plattform und Co. liefert danach das ohnehin offene GET /health.
internal static class NetworkDiscovery
{
    // Fester Port, unabhaengig von Server:Port: der Suchende kennt den HTTP-Port ja noch nicht.
    public const int Port = 5050;

    public static ReadOnlySpan<byte> Request => "YFREMOTE_DISCOVER_1"u8;

    private const string ServiceName = "YFRemote";

    public static byte[] CreateReply(int httpPort) =>
        JsonSerializer.SerializeToUtf8Bytes(new DiscoveryReply(ServiceName, httpPort), JsonSerializerOptions.Web);

    public static int? ParseReply(ReadOnlySpan<byte> buffer)
    {
        try
        {
            var reply = JsonSerializer.Deserialize<DiscoveryReply>(buffer, JsonSerializerOptions.Web);
            return reply is { Service: ServiceName, Port: >= 1 and <= 65535 } ? reply.Port : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static async Task RespondAsync(IPAddress bindAddress, int httpPort, CancellationToken cancellationToken, int port = Port)
    {
        using var udp = new UdpClient(new IPEndPoint(bindAddress, port));
        var reply = CreateReply(httpPort);
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var received = await udp.ReceiveAsync(cancellationToken);
                if (received.Buffer.AsSpan().SequenceEqual(Request))
                {
                    await udp.SendAsync(reply, received.RemoteEndPoint, cancellationToken);
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (SocketException)
            {
                // Windows meldet ein ICMP "Port unreachable" auf eine fruehere Antwort beim naechsten
                // Empfang als Fehler (WSAECONNRESET) - der Socket selbst bleibt brauchbar.
            }
        }
    }

    // Liefert die HTTP-Endpunkte aller Geraete, die innerhalb von duration antworten - ohne diesen
    // PC selbst, dessen eigener Responder den Broadcast ebenfalls beantwortet.
    public static async Task<IReadOnlyList<IPEndPoint>> DiscoverAsync(
        TimeSpan duration,
        CancellationToken cancellationToken,
        IReadOnlyCollection<IPAddress>? targets = null,
        int port = Port)
    {
        using var udp = new UdpClient(new IPEndPoint(IPAddress.Any, 0)) { EnableBroadcast = true };
        var request = Request.ToArray();
        foreach (var target in targets ?? NetworkAddressService.GetBroadcastAddresses())
        {
            try
            {
                await udp.SendAsync(request, new IPEndPoint(target, port), cancellationToken);
            }
            catch (SocketException)
            {
                // Ein Netz ohne Route (z. B. ein getrenntes VPN) darf die anderen nicht aufhalten.
            }
        }

        var ownAddresses = NetworkAddressService.GetLocalIpv4Addresses();
        var found = new Dictionary<IPAddress, IPEndPoint>();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(duration);
        while (true)
        {
            UdpReceiveResult received;
            try
            {
                received = await udp.ReceiveAsync(timeout.Token);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (SocketException)
            {
                continue;
            }

            var address = received.RemoteEndPoint.Address;
            if (ParseReply(received.Buffer) is { } httpPort && !ownAddresses.Contains(address))
            {
                found[address] = new IPEndPoint(address, httpPort);
            }
        }

        return [.. found.Values];
    }

    private sealed record DiscoveryReply(string Service, int Port);
}

// Beantwortet Suchanfragen, solange der Server laeuft. Ein belegter Port (anderes Programm, zweiter
// Testlauf) kostet nur die Auffindbarkeit, nicht den Server - manuell hinzufuegen geht weiter.
internal sealed class NetworkDiscoveryResponder(ServerOptions serverOptions, ILogger<NetworkDiscoveryResponder> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var bindAddress = serverOptions.Host is "0.0.0.0" or "*" or "+"
            ? IPAddress.Any
            : IPAddress.TryParse(serverOptions.Host, out var parsed) ? parsed : null;
        // Nur lokal gebunden (127.0.0.1, localhost): dann soll der Server im Netz auch nicht auftauchen.
        if (bindAddress is null || IPAddress.IsLoopback(bindAddress))
        {
            return;
        }

        try
        {
            await NetworkDiscovery.RespondAsync(bindAddress, serverOptions.Port, stoppingToken);
        }
        catch (SocketException exception)
        {
            logger.LogWarning(exception, "Network discovery is unavailable on UDP port {Port}.", NetworkDiscovery.Port);
        }
    }
}
