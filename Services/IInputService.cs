namespace YFRemote.Server.Services;

public interface IInputService
{
    void PressKey(string key);

    void PressHotkey(IReadOnlyList<string> keys);

    void KeyDown(string key);

    void KeyUp(string key);
}
