namespace YFRemote.Server.Configuration;

public sealed class ClipboardOptions
{
    public const string SectionName = "Clipboard";

    public long MaxImageSizeBytes { get; init; } = 20 * 1024 * 1024;

    public int MaxTextLength { get; init; } = 200_000;

    public void Validate()
    {
        if (MaxImageSizeBytes <= 0)
        {
            throw new InvalidOperationException("Clipboard:MaxImageSizeBytes must be greater than zero.");
        }

        if (MaxTextLength <= 0)
        {
            throw new InvalidOperationException("Clipboard:MaxTextLength must be greater than zero.");
        }
    }
}
