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
    private const int MinBitrateKbps = 1000;
    private const int MaxBitrateKbps = 40000;
    private const int DefaultBitrateKbps = 8000;

    internal static void MapScreenEndpoints(this WebApplication app)
    {
        // Die Monitore fuer die Auswahl im Tab "Bildschirm"; gleiche Pruefung wie GET /screen.
        app.MapGet("/screen/monitors", async context =>
        {
            if (await RequestGuards.AuthorizePairedDeviceAsync(context, originOptional: true) is null)
            {
                return;
            }

            context.Response.Headers.CacheControl = "no-store";
            if (context.RequestServices.GetService<IScreenCapture>() is not { } capture)
            {
                context.Response.StatusCode = StatusCodes.Status501NotImplemented;
                return;
            }

            await context.Response.WriteAsJsonAsync(
                new { monitors = capture.ListMonitors().Select(monitor => new { monitor.Id, monitor.Width, monitor.Height, monitor.Primary }) },
                context.RequestAborted);
        });

        // Ein Standbild eines Monitors fuer den Tab "Bildschirm"; der Client holt das naechste,
        // sobald eins angekommen ist. width ist die Anzeigebreite am Geraet - mehr Pixel waeren nur
        // laengere Uebertragung. Wie GET /windows: Bearer-Token, Origin nur pruefen, wenn einer
        // mitkommt, 501 ohne Bildschirmaufnahme (Linux), 503 auf dem sicheren Desktop.
        app.MapGet("/screen", async (HttpContext context, int? width, int? quality, string? monitor) =>
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
                    Math.Clamp(quality ?? DefaultQuality, MinQuality, MaxQuality),
                    monitor);
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

        // Derselbe Bildschirm als H.264-Video in fragmentiertem MP4, eine lange Antwort bis zum
        // Abbruch; der Client spielt sie per MediaSource ab. 501 ohne Hardware-Encoder - dann holt
        // der Client wieder JPEGs. Gleiche Pruefung wie GET /screen.
        app.MapGet("/screen/video", async (HttpContext context, int? width, int? bitrate, string? monitor) =>
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

            var pairing = context.RequestServices.GetRequiredService<PairingService>();
            var notifier = context.RequestServices.GetRequiredService<ScreenViewNotifier>();
            var aborted = context.RequestAborted;
            try
            {
                await capture.StreamVideoAsync(
                    Math.Clamp(width ?? DefaultWidth, MinWidth, MaxWidth),
                    Math.Clamp(bitrate ?? DefaultBitrateKbps, MinBitrateKbps, MaxBitrateKbps),
                    monitor,
                    codec =>
                    {
                        context.Response.ContentType = "video/mp4";
                        context.Response.Headers["X-Codec"] = codec;
                    },
                    async fragment =>
                    {
                        notifier.NotifyFrame(
                            deviceId,
                            () => pairing.GetPairedDevices().FirstOrDefault(device => device.Id == deviceId)?.Name ?? "Unbekanntes Gerät");
                        await context.Response.Body.WriteAsync(fragment, aborted);
                        await context.Response.Body.FlushAsync(aborted);
                    },
                    aborted);
            }
            catch (OperationCanceledException) when (aborted.IsCancellationRequested)
            {
            }
            catch (NotSupportedException exception) when (!context.Response.HasStarted)
            {
                app.Logger.LogInformation(exception, "Bildschirm-Video nicht verfuegbar, der Client nimmt JPEG.");
                context.Response.StatusCode = StatusCodes.Status501NotImplemented;
            }
            catch (Win32Exception) when (!context.Response.HasStarted)
            {
                context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            }
            catch (Exception exception) when (context.Response.HasStarted)
            {
                // Mitten im Stream (sicherer Desktop, Aufloesung geaendert): Antwort endet, der
                // Client verbindet sich neu.
                app.Logger.LogInformation(exception, "Bildschirm-Video abgebrochen.");
            }
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
