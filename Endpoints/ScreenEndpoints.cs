using System.ComponentModel;
using YFRemote.Server.Services;

namespace YFRemote.Server.Endpoints;

internal static class ScreenEndpoints
{
    private const int MinWidth = 320;
    private const int MaxWidth = 3840;
    private const int DefaultWidth = 1280;

    internal static void MapScreenEndpoints(this WebApplication app)
    {
        // Ein Standbild des Hauptbildschirms fuer den Tab "Bildschirm"; der Client holt das naechste,
        // sobald eins angekommen ist. width ist die Anzeigebreite am Geraet - mehr Pixel waeren nur
        // laengere Uebertragung. Wie GET /windows: Bearer-Token, Origin nur pruefen, wenn einer
        // mitkommt, 501 ohne Bildschirmaufnahme (Linux), 503 auf dem sicheren Desktop.
        app.MapGet("/screen", async (HttpContext context, int? width) =>
        {
            if (await RequestGuards.AuthorizePairedDeviceAsync(context, originOptional: true) is not { } deviceId)
            {
                return;
            }

            context.Response.Headers.CacheControl = "no-store";
            if (context.RequestServices.GetService<IScreenCapture>() is not { } capture)
            {
                context.Response.StatusCode = StatusCodes.Status501NotImplemented;
                return;
            }

            byte[] jpeg;
            try
            {
                jpeg = capture.CaptureJpeg(Math.Clamp(width ?? DefaultWidth, MinWidth, MaxWidth));
            }
            catch (Win32Exception)
            {
                context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
                return;
            }

            var pairing = context.RequestServices.GetRequiredService<PairingService>();
            context.RequestServices.GetRequiredService<ScreenViewNotifier>().NotifyFrame(
                deviceId,
                () => pairing.GetPairedDevices().FirstOrDefault(device => device.Id == deviceId)?.Name ?? "Unbekanntes Gerät");
            context.Response.ContentType = "image/jpeg";
            await context.Response.Body.WriteAsync(jpeg, context.RequestAborted);
        });
    }
}
