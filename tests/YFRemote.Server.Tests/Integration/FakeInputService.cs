using System.Collections.Concurrent;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Integration;

// Ersetzt IInputService und IMouseService in Integrationstests, damit /ws ueber den echten
// HTTP-Stack getestet werden kann, ohne Tastatur und Maus der Testmaschine zu bedienen - und
// unter Linux ohne /dev/uinput. Jeder Aufruf landet als lesbare Zeile in Calls.
public sealed class FakeInputService : IInputService, IMouseService
{
    public ConcurrentQueue<string> Calls { get; } = new();

    public void PressKey(string key) => Calls.Enqueue($"key {key}");

    public void PressHotkey(IReadOnlyList<string> keys) => Calls.Enqueue($"hotkey {string.Join('+', keys)}");

    public void TypeText(string text) => Calls.Enqueue($"text {text}");

    public void KeyDown(string key) => Calls.Enqueue($"keyDown {key}");

    public void KeyUp(string key) => Calls.Enqueue($"keyUp {key}");

    public void MoveRelative(int deltaX, int deltaY) => Calls.Enqueue($"move {deltaX},{deltaY}");

    public void ClickLeft() => Calls.Enqueue("click left");

    public void ClickRight() => Calls.Enqueue("click right");

    public void ClickMiddle() => Calls.Enqueue("click middle");

    public void ButtonDown(string button) => Calls.Enqueue($"down {button}");

    public void ButtonUp(string button) => Calls.Enqueue($"up {button}");

    public void Scroll(int delta) => Calls.Enqueue($"scroll {delta}");

    public void ScrollHorizontal(int delta) => Calls.Enqueue($"scrollX {delta}");
}
