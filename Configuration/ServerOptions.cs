namespace YFRemote.Server.Configuration;

public sealed class ServerOptions
{
    public const string SectionName = "Server";

    public string Host { get; init; } = "0.0.0.0";

    public int Port { get; init; } = 5050;

    public string Url => $"http://{Host}:{Port}";

    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(Host))
        {
            throw new InvalidOperationException("Server:Host must not be empty.");
        }

        if (Port is < 1 or > 65535)
        {
            throw new InvalidOperationException("Server:Port must be between 1 and 65535.");
        }
    }
}
