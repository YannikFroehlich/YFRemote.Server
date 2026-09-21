namespace YFRemote.Server.Services;

public sealed class FileTooLargeException(long maxBytes)
    : InvalidOperationException($"File exceeds the maximum allowed size of {maxBytes} bytes.");
