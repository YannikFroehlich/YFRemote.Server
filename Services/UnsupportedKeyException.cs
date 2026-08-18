namespace YFRemote.Server.Services;

public sealed class UnsupportedKeyException(string key)
    : InvalidOperationException($"Unsupported key: {key}");
