namespace YFRemote.Server.Services;

public sealed class GamepadUnavailableException(string message) : InvalidOperationException(message);
