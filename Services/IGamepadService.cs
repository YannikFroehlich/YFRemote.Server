using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

public interface IGamepadService
{
    // Ob der Treiber fuer virtuelle Controller installiert ist.
    bool IsAvailable { get; }

    // onRumble meldet Vibrationswuensche des Spiels; wird auf einem Treiber-Thread aufgerufen.
    IVirtualGamepad Connect(Action<GamepadRumble> onRumble);
}

public interface IVirtualGamepad : IDisposable
{
    void Update(GamepadState state);
}
