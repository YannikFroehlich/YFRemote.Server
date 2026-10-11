using YFRemote.Server.Models;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

// Deckt nur die Umsetzung von XInput auf evdev ab: Das Anlegen des Geraets braucht /dev/uinput auf
// einem echten Linux-Kernel - dafuer siehe AGENTS.md "Linux support".
[TestClass]
public sealed class LinuxGamepadServiceTests
{
    private const ushort EvKey = 0x01;
    private const ushort EvAbs = 0x03;

    [TestMethod]
    public void ToEvents_MapsButtonsLikeXpad()
    {
        // A, Y, Start
        var events = Events(new GamepadState(0x1000 | 0x8000 | 0x0010, 0, 0, 0, 0, 0, 0));

        Assert.AreEqual(1, events[(EvKey, 0x130)]); // BTN_A
        Assert.AreEqual(0, events[(EvKey, 0x131)]); // BTN_B
        Assert.AreEqual(1, events[(EvKey, 0x134)]); // BTN_Y
        Assert.AreEqual(1, events[(EvKey, 0x13B)]); // BTN_START
    }

    [TestMethod]
    public void ToEvents_InvertsVerticalStickAxesOverTheFullRange()
    {
        var events = Events(new GamepadState(0, short.MinValue, short.MaxValue, 100, short.MinValue, 64, 255));

        Assert.AreEqual(short.MinValue, events[(EvAbs, 0x00)]); // ABS_X
        Assert.AreEqual(short.MinValue, events[(EvAbs, 0x01)]); // ABS_Y: oben -> negativ
        Assert.AreEqual(100, events[(EvAbs, 0x03)]); // ABS_RX
        Assert.AreEqual(short.MaxValue, events[(EvAbs, 0x04)]); // ABS_RY: unten -> positiv
        Assert.AreEqual(64, events[(EvAbs, 0x02)]); // ABS_Z
        Assert.AreEqual(255, events[(EvAbs, 0x05)]); // ABS_RZ
    }

    [TestMethod]
    public void ToEvents_MapsDpadToHatAxes()
    {
        // oben + links
        var upLeft = Events(new GamepadState(0x0001 | 0x0004, 0, 0, 0, 0, 0, 0));
        // unten + rechts
        var downRight = Events(new GamepadState(0x0002 | 0x0008, 0, 0, 0, 0, 0, 0));

        Assert.AreEqual(-1, upLeft[(EvAbs, 0x10)]);
        Assert.AreEqual(-1, upLeft[(EvAbs, 0x11)]);
        Assert.AreEqual(1, downRight[(EvAbs, 0x10)]);
        Assert.AreEqual(1, downRight[(EvAbs, 0x11)]);
    }

    private static Dictionary<(ushort Type, ushort Code), int> Events(GamepadState state) =>
        LinuxGamepadService.ToEvents(state).ToDictionary(e => (e.Type, e.Code), e => e.Value);
}
