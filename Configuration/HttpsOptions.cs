namespace YFRemote.Server.Configuration;

public sealed class HttpsOptions
{
    public const string SectionName = "Https";

    public bool Enabled { get; init; }

    public int Port { get; init; } = 5443;

    public string CertificateAuthorityPath { get; init; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "YFRemote",
        "ca.pfx");

    public void Validate()
    {
        if (Port is < 1 or > 65535)
        {
            throw new InvalidOperationException("Https:Port must be between 1 and 65535.");
        }

        if (string.IsNullOrWhiteSpace(CertificateAuthorityPath))
        {
            throw new InvalidOperationException("Https:CertificateAuthorityPath must not be empty.");
        }
    }
}
