using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Integration;

// Ersetzt IClipboardService in Integrationstests ueber Program.BuildApplication's
// configureServices-Hook, damit Tests niemals die echte Systemzwischenablage der Maschine
// veraendern, auf der sie laufen.
public sealed class FakeClipboardService : IClipboardService
{
    public string? LastText { get; private set; }

    public byte[]? LastImageBytes { get; private set; }

    public Exception? ThrowOnNextCall { get; set; }

    public string? TextToReturn { get; set; }

    public byte[]? ImageToReturn { get; set; }

    public string? ImageIdToReturn { get; set; }

    public IReadOnlyList<string>? LastFiles { get; private set; }

    public long? ChangeCount { get; set; }

    public int TextReads { get; private set; }

    public Task<string?> GetImageIdAsync() => Task.FromResult(ImageIdToReturn);

    public Task SetFilesAsync(IReadOnlyList<string> paths)
    {
        if (ThrowOnNextCall is { } exception)
        {
            ThrowOnNextCall = null;
            throw exception;
        }

        LastFiles = paths;
        return Task.CompletedTask;
    }

    public Task<string?> GetTextAsync()
    {
        if (ThrowOnNextCall is { } exception)
        {
            ThrowOnNextCall = null;
            throw exception;
        }

        TextReads++;
        return Task.FromResult(TextToReturn);
    }

    public Task<byte[]?> GetImageAsync()
    {
        if (ThrowOnNextCall is { } exception)
        {
            ThrowOnNextCall = null;
            throw exception;
        }

        return Task.FromResult(ImageToReturn);
    }

    public Task SetTextAsync(string text)
    {
        if (ThrowOnNextCall is { } exception)
        {
            ThrowOnNextCall = null;
            throw exception;
        }

        LastText = text;
        return Task.CompletedTask;
    }

    public async Task SetImageAsync(Stream imageStream)
    {
        if (ThrowOnNextCall is { } exception)
        {
            ThrowOnNextCall = null;
            throw exception;
        }

        using var buffer = new MemoryStream();
        await imageStream.CopyToAsync(buffer);
        LastImageBytes = buffer.ToArray();
    }
}
