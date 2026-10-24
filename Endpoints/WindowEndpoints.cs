using YFRemote.Server.Services;

namespace YFRemote.Server.Endpoints;

internal static class WindowEndpoints
{
    internal static void MapWindowEndpoints(this WebApplication app)
    {
        // Die offenen Fenster fuer den Fensterwechsel im Tab "PC"; "focusWindow" holt eins nach vorn.
        // Wie GET /launch/apps: Bearer-Token, Origin nur pruefen, wenn einer mitkommt. 501 ohne
        // Fensterliste (Linux).
        app.MapGet("/windows", async context =>
        {
            if (await RequestGuards.AuthorizePairedDeviceAsync(context, originOptional: true) is null)
            {
                return;
            }

            context.Response.Headers.CacheControl = "no-store";
            if (context.RequestServices.GetService<IWindowService>() is not { } windows)
            {
                context.Response.StatusCode = StatusCodes.Status501NotImplemented;
                return;
            }

            await context.Response.WriteAsJsonAsync(new { windows = windows.ListWindows() }, context.RequestAborted);
        });
    }
}
