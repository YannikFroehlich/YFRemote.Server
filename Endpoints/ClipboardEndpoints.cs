using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using YFRemote.Server.Configuration;
using YFRemote.Server.Models;
using YFRemote.Server.Services;

namespace YFRemote.Server.Endpoints;

internal static class ClipboardEndpoints
{
    internal static void MapClipboardEndpoints(this WebApplication app)
    {
        app.MapPost("/clipboard/text", async context =>
        {
            if (await RequestGuards.AuthorizePairedDeviceAsync(context) is null)
            {
                return;
            }

            ClipboardTextRequest? request;
            try
            {
                request = await context.Request.ReadFromJsonAsync<ClipboardTextRequest>(context.RequestAborted);
            }
            catch (JsonException)
            {
                await context.Response.WriteAsJsonAsync(ClipboardResponse.Fail("Invalid JSON."), context.RequestAborted);
                return;
            }

            var clipboardOptions = context.RequestServices.GetRequiredService<ClipboardOptions>();
            var text = request?.Text;

            if (string.IsNullOrEmpty(text))
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsJsonAsync(
                    ClipboardResponse.Fail("Text must not be empty."),
                    context.RequestAborted);
                return;
            }

            if (text.Length > clipboardOptions.MaxTextLength)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsJsonAsync(
                    ClipboardResponse.Fail($"Text must be at most {clipboardOptions.MaxTextLength} characters."),
                    context.RequestAborted);
                return;
            }

            var clipboardService = context.RequestServices.GetRequiredService<IClipboardService>();
            await TrySetClipboardAsync(context, app.Logger, () => clipboardService.SetTextAsync(text));
        });

        app.MapPost("/clipboard/image", async context =>
        {
            if (await RequestGuards.AuthorizePairedDeviceAsync(context) is null)
            {
                return;
            }

            var clipboardOptions = context.RequestServices.GetRequiredService<ClipboardOptions>();

            context.Features.Get<IHttpMaxRequestBodySizeFeature>()!.MaxRequestBodySize =
                clipboardOptions.MaxImageSizeBytes;

            if (context.Request.ContentLength is { } contentLength
                && contentLength > clipboardOptions.MaxImageSizeBytes)
            {
                context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
                await context.Response.WriteAsJsonAsync(
                    ClipboardResponse.Fail("Image is too large."),
                    context.RequestAborted);
                return;
            }

            if (!context.Request.HasFormContentType)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsJsonAsync(
                    ClipboardResponse.Fail("Expected multipart/form-data."),
                    context.RequestAborted);
                return;
            }

            var form = await context.Request.ReadFormAsync(context.RequestAborted);
            var file = form.Files.Count > 0 ? form.Files[0] : null;
            if (file is null || file.Length == 0)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsJsonAsync(
                    ClipboardResponse.Fail("No image was sent."),
                    context.RequestAborted);
                return;
            }

            // file.Length ist nach ReadFormAsync bereits der tatsaechliche, durch das
            // MaxRequestBodySize-Limit oben begrenzte Wert - kein weiteres manuelles
            // Streaming-Limit noetig (anders als /files, wo gegen einen irrefuehrenden
            // Content-Length-Header auf dem rohen Request abgesichert werden musste).
            if (file.Length > clipboardOptions.MaxImageSizeBytes)
            {
                context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
                await context.Response.WriteAsJsonAsync(
                    ClipboardResponse.Fail("Image is too large."),
                    context.RequestAborted);
                return;
            }

            var clipboardService = context.RequestServices.GetRequiredService<IClipboardService>();
            using var imageStream = new MemoryStream();
            await using (var fileStream = file.OpenReadStream())
            {
                await fileStream.CopyToAsync(imageStream, context.RequestAborted);
            }
            imageStream.Position = 0;

            await TrySetClipboardAsync(context, app.Logger, () => clipboardService.SetImageAsync(imageStream));
        });

        // Origin nur pruefen, wenn einer mitkommt: Browser senden bei einem Same-Origin-GET-fetch()
        // keinen (siehe /pair/status). Den Schutz traegt hier das Bearer-Token - eine fremde Seite
        // kennt es nicht und koennte den Authorization-Header ohne CORS-Freigabe gar nicht senden.
        app.MapGet("/clipboard/text", async context =>
        {
            if (await RequestGuards.AuthorizePairedDeviceAsync(context, originOptional: true) is not { } deviceId)
            {
                return;
            }

            // Die Antwort enthaelt den Inhalt der PC-Zwischenablage (ggf. Passwoerter) - nie cachen.
            context.Response.Headers.CacheControl = "no-store";

            var clipboardOptions = context.RequestServices.GetRequiredService<ClipboardOptions>();
            var clipboardService = context.RequestServices.GetRequiredService<IClipboardService>();
            await RunClipboardOperationAsync(context, app.Logger, async () =>
            {
                var text = await clipboardService.GetTextAsync();
                if (string.IsNullOrEmpty(text))
                {
                    return ClipboardResponse.WithText(null);
                }

                if (text.Length > clipboardOptions.MaxTextLength)
                {
                    context.Response.StatusCode = StatusCodes.Status422UnprocessableEntity;
                    return ClipboardResponse.Fail(
                        $"Clipboard text is longer than {clipboardOptions.MaxTextLength} characters.");
                }

                NotifyRead(context, app.Logger, deviceId, "text");
                return ClipboardResponse.WithText(text);
            });
        });

        // Wie GET /clipboard/text, nur steht das Bild als PNG im Rumpf; 204 ohne Bild. Der Client
        // fragt erst danach, wenn die Zwischenablage keinen Text enthaelt.
        app.MapGet("/clipboard/image", async context =>
        {
            if (await RequestGuards.AuthorizePairedDeviceAsync(context, originOptional: true) is not { } deviceId)
            {
                return;
            }

            context.Response.Headers.CacheControl = "no-store";

            var clipboardOptions = context.RequestServices.GetRequiredService<ClipboardOptions>();
            var clipboardService = context.RequestServices.GetRequiredService<IClipboardService>();
            byte[]? image = null;
            await RunClipboardOperationAsync(context, app.Logger, async () =>
            {
                var png = await clipboardService.GetImageAsync();
                if (png is null)
                {
                    context.Response.StatusCode = StatusCodes.Status204NoContent;
                    return null;
                }

                if (png.Length > clipboardOptions.MaxImageSizeBytes)
                {
                    context.Response.StatusCode = StatusCodes.Status422UnprocessableEntity;
                    return ClipboardResponse.Fail("Clipboard image is too large.");
                }

                image = png;
                return null;
            });

            if (image is null)
            {
                return;
            }

            NotifyRead(context, app.Logger, deviceId, "image");
            context.Response.ContentType = "image/png";
            await context.Response.Body.WriteAsync(image, context.RequestAborted);
        });
    }

    private static void NotifyRead(HttpContext context, ILogger logger, Guid deviceId, string kind)
    {
        var deviceName = context.RequestServices.GetRequiredService<PairingService>()
            .GetPairedDevices()
            .FirstOrDefault(device => device.Id == deviceId)?.Name ?? "Unbekanntes Gerät";
        logger.LogInformation("Clipboard {Kind} sent to paired device {DeviceName}.", kind, deviceName);
        context.RequestServices.GetRequiredService<ClipboardReadNotifier>().NotifyRead(deviceName);
    }

    private static Task TrySetClipboardAsync(HttpContext context, ILogger logger, Func<Task> operation) =>
        RunClipboardOperationAsync(context, logger, async () =>
        {
            await operation();
            return ClipboardResponse.Ok();
        });

    // Liefert operation null, antwortet der Aufrufer selbst (Bild statt JSON, 204).
    private static async Task RunClipboardOperationAsync(
        HttpContext context,
        ILogger logger,
        Func<Task<ClipboardResponse?>> operation)
    {
        ClipboardResponse? response;
        try
        {
            response = await operation();
        }
        catch (NotSupportedException exception)
        {
            context.Response.StatusCode = StatusCodes.Status501NotImplemented;
            response = ClipboardResponse.Fail(exception.Message);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Clipboard operation failed.");
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            response = ClipboardResponse.Fail("Clipboard operation failed.");
        }

        if (response is not null)
        {
            await context.Response.WriteAsJsonAsync(response, context.RequestAborted);
        }
    }
}
