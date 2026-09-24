using System.Text.Json;
using YFRemote.Server.Models;
using YFRemote.Server.Services;
using YFRemote.Server.WebSockets;

namespace YFRemote.Server.Endpoints;

internal static class PairingEndpoints
{
    internal static void MapPairingEndpoints(this WebApplication app)
    {
        app.MapPost("/pair", async context =>
        {
            if (!RequestGuards.IsAllowedOrigin(context.Request))
            {
                await RequestGuards.WriteOriginRejectedAsync(context.Response);
                return;
            }

            var pairingService = context.RequestServices.GetRequiredService<PairingService>();

            PairRequest? request;
            try
            {
                request = await context.Request.ReadFromJsonAsync<PairRequest>(context.RequestAborted);
            }
            catch (JsonException)
            {
                await context.Response.WriteAsJsonAsync(PairResponse.Fail("Invalid JSON."), context.RequestAborted);
                return;
            }

            var clientIp = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            await context.Response.WriteAsJsonAsync(
                pairingService.TryPair(request, clientIp),
                context.RequestAborted);
        });

        app.MapDelete("/pair", async context =>
        {
            if (!RequestGuards.IsAllowedOrigin(context.Request))
            {
                await RequestGuards.WriteOriginRejectedAsync(context.Response);
                return;
            }

            var token = RequestGuards.GetBearerToken(context.Request);
            var pairingService = context.RequestServices.GetRequiredService<PairingService>();

            switch (pairingService.RemoveDeviceByToken(token, out var deviceId))
            {
                case PairingRemovalResult.Removed:
                    context.RequestServices
                        .GetRequiredService<WebSocketConnectionRegistry>()
                        .CloseConnections(deviceId);
                    context.Response.StatusCode = StatusCodes.Status204NoContent;
                    return;
                case PairingRemovalResult.NotFound:
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return;
                case PairingRemovalResult.PersistenceFailed:
                    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                    await context.Response.WriteAsJsonAsync(
                        new
                        {
                            success = false,
                            error = "Entkopplung konnte nicht dauerhaft gespeichert werden. Bitte erneut versuchen."
                        },
                        context.RequestAborted);
                    return;
                default:
                    throw new InvalidOperationException("Unknown pairing removal result.");
            }
        });

        // Keine Origin-Pruefung: Browser senden bei einem Same-Origin-GET-fetch() ueblicherweise
        // keinen Origin-Header (anders als bei POST oder beim WebSocket-Handshake), und dieser
        // Endpoint liefert ohnehin nur ein Ja/Nein zu einem Token, das der Aufrufer bereits kennen
        // muss - ohne den kryptografisch zufaelligen Token laesst sich hieraus nichts gewinnen.
        app.MapGet("/pair/status", async context =>
        {
            var pairingService = context.RequestServices.GetRequiredService<PairingService>();
            var token = context.Request.Query["token"].ToString();
            await context.Response.WriteAsJsonAsync(
                new PairStatusResponse(pairingService.IsValidToken(token)),
                context.RequestAborted);
        });
    }
}
