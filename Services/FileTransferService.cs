using YFRemote.Server.Configuration;

namespace YFRemote.Server.Services;

public sealed class FileTransferService(FileTransferOptions options, ILogger<FileTransferService> logger)
{
    private const int BufferSize = 81920;

    public event Action<string>? FileReceived;

    public async Task<string> SaveFileAsync(
        string requestedFileName,
        Stream content,
        CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(options.TargetDirectory);

        var targetPath = ResolveUniquePath(SanitizeFileName(requestedFileName));

        try
        {
            await using (var output = File.Create(targetPath))
            {
                await CopyWithLimitAsync(content, output, options.MaxFileSizeBytes, cancellationToken);
            }
        }
        catch
        {
            File.Delete(targetPath);
            throw;
        }

        var savedFileName = Path.GetFileName(targetPath);
        logger.LogInformation("Received file saved as {FileName}.", savedFileName);
        FileReceived?.Invoke(savedFileName);

        return savedFileName;
    }

    // Path.GetFileName wirft jeglichen Verzeichnisanteil weg (auch "..\..\evil.exe"), das ist die
    // eigentliche Absicherung gegen Pfad-Traversal - der Zeichen-Ersatz danach macht den Namen nur
    // auf Windows gültig.
    private static string SanitizeFileName(string requestedFileName)
    {
        var fileName = Path.GetFileName(requestedFileName);
        if (string.IsNullOrWhiteSpace(fileName))
        {
            fileName = "Datei";
        }

        foreach (var invalidChar in Path.GetInvalidFileNameChars())
        {
            fileName = fileName.Replace(invalidChar, '_');
        }

        return fileName;
    }

    private string ResolveUniquePath(string fileName)
    {
        var candidatePath = Path.Combine(options.TargetDirectory, fileName);
        if (!File.Exists(candidatePath))
        {
            return candidatePath;
        }

        var nameWithoutExtension = Path.GetFileNameWithoutExtension(fileName);
        var extension = Path.GetExtension(fileName);

        for (var suffix = 2; ; suffix++)
        {
            candidatePath = Path.Combine(options.TargetDirectory, $"{nameWithoutExtension} ({suffix}){extension}");
            if (!File.Exists(candidatePath))
            {
                return candidatePath;
            }
        }
    }

    // Zaehlt die tatsaechlich gelesenen Bytes mit, statt sich auf Content-Length zu verlassen -
    // der Header kann fehlen oder nicht zum echten Body-Umfang passen.
    private static async Task CopyWithLimitAsync(
        Stream source,
        Stream destination,
        long maxBytes,
        CancellationToken cancellationToken)
    {
        var buffer = new byte[BufferSize];
        long totalBytesRead = 0;
        int bytesRead;

        while ((bytesRead = await source.ReadAsync(buffer, cancellationToken)) > 0)
        {
            totalBytesRead += bytesRead;
            if (totalBytesRead > maxBytes)
            {
                throw new FileTooLargeException(maxBytes);
            }

            await destination.WriteAsync(buffer.AsMemory(0, bytesRead), cancellationToken);
        }
    }
}
