using Microsoft.AspNetCore.Http.Features;
using YFRemote.Server.Configuration;
using YFRemote.Server.Models;
using YFRemote.Server.Services;

namespace YFRemote.Server.Endpoints;

internal static class FileEndpoints
{
    internal static void MapFileEndpoints(this WebApplication app)
    {
        app.MapPost("/files", async context =>
        {
            if (await RequestGuards.AuthorizePairedDeviceAsync(context) is null)
            {
                return;
            }

            var fileTransferOptions = context.RequestServices.GetRequiredService<FileTransferOptions>();

            // Kestrel begrenzt einen Request standardmaessig auf rund 30 MB; ohne diese Anhebung
            // wuerde ein groesserer, aber sonst gueltiger Upload schon vor unserer eigenen Pruefung
            // unten abgewiesen.
            context.Features.Get<IHttpMaxRequestBodySizeFeature>()!.MaxRequestBodySize =
                fileTransferOptions.MaxFileSizeBytes;

            if (context.Request.ContentLength is { } contentLength
                && contentLength > fileTransferOptions.MaxFileSizeBytes)
            {
                context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
                await context.Response.WriteAsJsonAsync(
                    FileUploadResponse.Fail("File is too large."),
                    context.RequestAborted);
                return;
            }

            if (!context.Request.HasFormContentType)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsJsonAsync(
                    FileUploadResponse.Fail("Expected multipart/form-data."),
                    context.RequestAborted);
                return;
            }

            var form = await context.Request.ReadFormAsync(context.RequestAborted);
            var file = form.Files.Count > 0 ? form.Files[0] : null;
            if (file is null || file.Length == 0)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsJsonAsync(
                    FileUploadResponse.Fail("No file was sent."),
                    context.RequestAborted);
                return;
            }

            var fileTransferService = context.RequestServices.GetRequiredService<FileTransferService>();
            try
            {
                await using var stream = file.OpenReadStream();
                var savedFileName = await fileTransferService.SaveFileAsync(
                    file.FileName,
                    stream,
                    context.RequestAborted);
                await context.Response.WriteAsJsonAsync(
                    FileUploadResponse.Ok(savedFileName),
                    context.RequestAborted);
            }
            catch (FileTooLargeException)
            {
                context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
                await context.Response.WriteAsJsonAsync(
                    FileUploadResponse.Fail("File is too large."),
                    context.RequestAborted);
            }
        });
    }
}
