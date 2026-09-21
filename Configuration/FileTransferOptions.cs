namespace YFRemote.Server.Configuration;

public sealed class FileTransferOptions
{
    public const string SectionName = "FileTransfer";

    public string TargetDirectory { get; init; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        "YFRemote");

    public long MaxFileSizeBytes { get; init; } = 200 * 1024 * 1024;

    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(TargetDirectory))
        {
            throw new InvalidOperationException("FileTransfer:TargetDirectory must not be empty.");
        }

        if (MaxFileSizeBytes <= 0)
        {
            throw new InvalidOperationException("FileTransfer:MaxFileSizeBytes must be greater than zero.");
        }
    }
}
