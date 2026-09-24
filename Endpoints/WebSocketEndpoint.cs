using YFRemote.Server.Services;
using YFRemote.Server.WebSockets;

namespace YFRemote.Server.Endpoints;

internal static class WebSocketEndpoint
{
    internal static void MapWebSocketEndpoint(this WebApplication app)
    {
        app.Map("/ws", async context =>
        {
            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsync("WebSocket connection required.");
                return;
            }

            if (!RequestGuards.IsAllowedOrigin(context.Request))
            {
                app.Logger.LogWarning(
                    "Rejected WebSocket handshake with disallowed Origin '{Origin}' from {RemoteAddress}.",
                    context.Request.Headers.Origin.ToString(),
                    context.Connection.RemoteIpAddress);
                await RequestGuards.WriteOriginRejectedAsync(context.Response);
                return;
            }

            var pairingService = context.RequestServices.GetRequiredService<PairingService>();
            var token = context.Request.Query["token"].ToString();
            if (!pairingService.TryValidateToken(token, out var deviceId))
            {
                app.Logger.LogWarning(
                    "Rejected WebSocket handshake with invalid pairing token from {RemoteAddress}.",
                    context.Connection.RemoteIpAddress);
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                await context.Response.WriteAsync("Pairing required.");
                return;
            }

            var connectionRegistry = context.RequestServices.GetRequiredService<WebSocketConnectionRegistry>();
            var handler = context.RequestServices.GetRequiredService<YFRemoteWebSocketHandler>();
            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            var client = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

            // Ein eigener CancellationTokenSource statt direkt context.RequestAborted, damit ein
            // Entkoppeln des Geräts (Tray oder DELETE /pair) diese Verbindung gezielt beenden kann,
            // ohne auf ein Schließen durch den Client warten zu müssen.
            using var connectionCts = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
            using (connectionRegistry.Register(deviceId, connectionCts))
            {
                await handler.HandleAsync(socket, client, connectionCts.Token);
            }
        });
    }
}
