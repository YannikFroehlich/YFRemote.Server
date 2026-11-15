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

        // Die Prozesse mit der hoechsten Last fuer den Tab "PC"; "killProcess" beendet einen. Die
        // Antwort dauert eine halbe Sekunde, weil die CPU-Last zwei Messungen braucht. Gleiches Tor.
        app.MapGet("/processes", async context =>
        {
            if (await RequestGuards.AuthorizePairedDeviceAsync(context, originOptional: true) is null)
            {
                return;
            }

            context.Response.Headers.CacheControl = "no-store";
            var processes = await context.RequestServices.GetRequiredService<IProcessService>()
                .ListAsync(context.RequestAborted);
            await context.Response.WriteAsJsonAsync(new { processes }, context.RequestAborted);
        });

        // Die Helligkeitsregler im Tab "PC", gesetzt per "brightness"; dasselbe Tor wie GET /windows.
        app.MapGet("/brightness", async context =>
        {
            if (await RequestGuards.AuthorizePairedDeviceAsync(context, originOptional: true) is null)
            {
                return;
            }

            context.Response.Headers.CacheControl = "no-store";
            if (context.RequestServices.GetService<IBrightnessService>() is not { } brightness)
            {
                context.Response.StatusCode = StatusCodes.Status501NotImplemented;
                return;
            }

            await context.Response.WriteAsJsonAsync(new { monitors = brightness.List() }, context.RequestAborted);
        });
    }
}
