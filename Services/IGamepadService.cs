using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

public interface IGamepadService
{
    // Ob der Treiber fuer virtuelle Controller installiert ist.
    bool IsAvailable { get; }

    IVirtualGamepad Connect();
}

public interface IVirtualGamepad : IDisposable
{
    void Update(GamepadState state);
}
