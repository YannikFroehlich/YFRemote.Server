using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;
using YFRemote.Server.Services;

namespace YFRemote.Server.Endpoints;

internal static class ScreenEndpoints
{
    private const int MinWidth = 320;
    private const int MaxWidth = 3840;
    private const int DefaultWidth = 1280;
    private const int MinQuality = 30;
    private const int MaxQuality = 95;
    private const int DefaultQuality = 70;

    internal static void MapScreenEndpoints(this WebApplication app)
    {
        // Ein Standbild des Hauptbildschirms fuer den Tab "Bildschirm"; der Client holt das naechste,
        // sobald eins angekommen ist. width ist die Anzeigebreite am Geraet - mehr Pixel waeren nur
        // laengere Uebertragung. Wie GET /windows: Bearer-Token, Origin nur pruefen, wenn einer
        // mitkommt, 501 ohne Bildschirmaufnahme (Linux), 503 auf dem sicheren Desktop.
        app.MapGet("/screen", async (HttpContext context, int? width, int? quality) =>
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
                jpeg = capture.CaptureJpeg(
                    Math.Clamp(width ?? DefaultWidth, MinWidth, MaxWidth),
                    Math.Clamp(quality ?? DefaultQuality, MinQuality, MaxQuality));
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

        // Der PC-Ton zum Bildschirm-Tab: eine einzige lange Antwort mit rohem 16-Bit-PCM, bis das
        // Geraet abbricht. Roh statt komprimiert, weil der Browser PCM ohne Decoder abspielt und
        // ~1,5 MBit/s im LAN nicht stoeren. Format in den Kopfzeilen, gleiche Pruefung wie oben.
        app.MapGet("/screen/audio", async (HttpContext context) =>
        {
            if (await RequestGuards.AuthorizePairedDeviceAsync(context, originOptional: true) is null)
            {
                return;
            }

            context.Response.Headers.CacheControl = "no-store";
            if (context.RequestServices.GetService<IAudioCapture>() is not { } capture)
            {
                context.Response.StatusCode = StatusCodes.Status501NotImplemented;
                return;
            }

            var aborted = context.RequestAborted;
            try
            {
                await capture.CaptureAsync(
                    (sampleRate, channels) =>
                    {
                        context.Response.ContentType = "application/octet-stream";
                        context.Response.Headers["X-Sample-Rate"] = sampleRate.ToString(CultureInfo.InvariantCulture);
                        context.Response.Headers["X-Channels"] = channels.ToString(CultureInfo.InvariantCulture);
                    },
                    async chunk =>
                    {
                        await context.Response.Body.WriteAsync(chunk, aborted);
                        await context.Response.Body.FlushAsync(aborted);
                    },
                    aborted);
            }
            catch (OperationCanceledException) when (aborted.IsCancellationRequested)
            {
            }
            catch (Exception exception) when (!context.Response.HasStarted && exception is COMException or NotSupportedException)
            {
                // Kein Wiedergabegeraet oder ein Format, das der Mitschnitt nicht kann.
                app.Logger.LogWarning(exception, "PC-Ton kann nicht mitgeschnitten werden.");
                context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            }
        });
    }
}
