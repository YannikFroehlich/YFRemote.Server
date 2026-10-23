using YFRemote.Server.Services;

namespace YFRemote.Server.Endpoints;

internal static class MediaEndpoints
{
    internal static void MapMediaEndpoints(this WebApplication app)
    {
        // Das Albumcover der Medienleiste; die Push-Nachricht "media" traegt nur seine CoverId, damit
        // das Bild nicht jede Sekunde mitgeht. Wie GET /clipboard/image: Bearer-Token, Origin nur
        // pruefen, wenn einer mitkommt; 204 ohne Cover.
        app.MapGet("/media/cover", async context =>
        {
            if (await RequestGuards.AuthorizePairedDeviceAsync(context, originOptional: true) is null)
            {
                return;
            }

            context.Response.Headers.CacheControl = "no-store";
            if (context.RequestServices.GetService<IMediaControl>()?.Cover is not { } cover)
            {
                context.Response.StatusCode = StatusCodes.Status204NoContent;
                return;
            }

            context.Response.ContentType = cover.ContentType;
            await context.Response.Body.WriteAsync(cover.Data, context.RequestAborted);
        });
    }
}
