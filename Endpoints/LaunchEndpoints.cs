using YFRemote.Server.Services;

namespace YFRemote.Server.Endpoints;

internal static class LaunchEndpoints
{
    internal static void MapLaunchEndpoints(this WebApplication app)
    {
        // Die Apps, die ein eigener Button per "launch" starten darf - fuer die Vorschlaege im
        // Button-Editor. Wie GET /media/cover: Bearer-Token, Origin nur pruefen, wenn einer mitkommt.
        app.MapGet("/launch/apps", async context =>
        {
            if (await RequestGuards.AuthorizePairedDeviceAsync(context, originOptional: true) is null)
            {
                return;
            }

            context.Response.Headers.CacheControl = "no-store";
            var apps = context.RequestServices.GetService<IAppLauncher>()?.ListApps() ?? [];
            await context.Response.WriteAsJsonAsync(new { apps }, context.RequestAborted);
        });
    }
}
