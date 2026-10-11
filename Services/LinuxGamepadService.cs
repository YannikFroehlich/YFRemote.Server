using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Linux braucht dafuer keinen Treiber: uinput legt jeden Controller als eigenes Eingabegeraet an.
// Es meldet sich mit der USB-ID und den Tasten-/Achsencodes eines kabelgebundenen Xbox-360-Controllers
// unter dem Kerneltreiber xpad, damit SDL, Steam und Proton es ohne eigenes Mapping erkennen.
// ponytail: keine Vibration - dafuer muesste der Dienst die Force-Feedback-Uploads
// (UI_BEGIN_FF_UPLOAD) vom Geraet lesen; nachruesten, wenn sie jemand vermisst.
public sealed class LinuxGamepadService(ILogger<LinuxGamepadService> logger) : IGamepadService
{
    private const ushort AbsX = 0x00;
    private const ushort AbsY = 0x01;
    private const ushort AbsZ = 0x02;
    private const ushort AbsRx = 0x03;
    private const ushort AbsRy = 0x04;
    private const ushort AbsRz = 0x05;
    private const ushort AbsHat0X = 0x10;
    private const ushort AbsHat0Y = 0x11;

    private const ushort DpadUp = 0x0001;
    private const ushort DpadDown = 0x0002;
    private const ushort DpadLeft = 0x0004;
    private const ushort DpadRight = 0x0008;

    // XInput-Bit -> Linux-Tastencode, wie xpad sie meldet (X/Y als BTN_X/BTN_Y, nicht nach Lage).
    private static readonly (ushort Mask, ushort Code)[] Buttons =
    [
        (0x1000, 0x130), // A -> BTN_A
        (0x2000, 0x131), // B -> BTN_B
        (0x4000, 0x133), // X -> BTN_X
        (0x8000, 0x134), // Y -> BTN_Y
        (0x0100, 0x136), // LB -> BTN_TL
        (0x0200, 0x137), // RB -> BTN_TR
        (0x0020, 0x13A), // Back -> BTN_SELECT
        (0x0010, 0x13B), // Start -> BTN_START
        (0x0400, 0x13C), // Guide -> BTN_MODE
        (0x0040, 0x13D), // linker Stick -> BTN_THUMBL
        (0x0080, 0x13E), // rechter Stick -> BTN_THUMBR
    ];

    private static readonly UinputAbsAxis[] Axes =
    [
        new(AbsX, short.MinValue, short.MaxValue, Fuzz: 16, Flat: 128),
        new(AbsY, short.MinValue, short.MaxValue, Fuzz: 16, Flat: 128),
        new(AbsRx, short.MinValue, short.MaxValue, Fuzz: 16, Flat: 128),
        new(AbsRy, short.MinValue, short.MaxValue, Fuzz: 16, Flat: 128),
        new(AbsZ, 0, byte.MaxValue),
        new(AbsRz, 0, byte.MaxValue),
        new(AbsHat0X, -1, 1),
        new(AbsHat0Y, -1, 1),
    ];

    private static readonly UinputId Xbox360Id = new(Vendor: 0x045E, Product: 0x028E, Version: 0x0114);

    // Ohne Kernelmodul gibt es kein /dev/uinput. Fehlt nur die Berechtigung, scheitert Connect mit
    // demselben Hinweis wie Tastatur und Maus.
    public bool IsAvailable => File.Exists("/dev/uinput");

    public IVirtualGamepad Connect(Action<GamepadRumble> onRumble)
    {
        var device = LinuxInputSender.UinputDevice.Create(
            // Name wie beim echten Controller unter xpad: manche Spiele erkennen ihn nur daran.
            "Microsoft X-Box 360 pad",
            keyCodes: Buttons.Select(button => button.Code).ToArray(),
            absAxes: Axes,
            id: Xbox360Id);
        logger.LogInformation("Virtual Xbox controller connected.");
        return new VirtualGamepad(device, logger);
    }

    internal static IEnumerable<(ushort Type, ushort Code, int Value)> ToEvents(GamepadState state)
    {
        foreach (var (mask, code) in Buttons)
        {
            yield return (LinuxInputSender.EvKey, code, (state.Buttons & mask) != 0 ? 1 : 0);
        }

        // XInput zaehlt Y nach oben positiv, evdev nach unten; xpad spiegelt mit ~ und trifft so
        // den Wertebereich exakt (-32768 -> 32767).
        yield return (LinuxInputSender.EvAbs, AbsX, state.LeftX);
        yield return (LinuxInputSender.EvAbs, AbsY, ~state.LeftY);
        yield return (LinuxInputSender.EvAbs, AbsRx, state.RightX);
        yield return (LinuxInputSender.EvAbs, AbsRy, ~state.RightY);
        yield return (LinuxInputSender.EvAbs, AbsZ, state.LeftTrigger);
        yield return (LinuxInputSender.EvAbs, AbsRz, state.RightTrigger);
        yield return (LinuxInputSender.EvAbs, AbsHat0X, Pressed(state, DpadRight) - Pressed(state, DpadLeft));
        yield return (LinuxInputSender.EvAbs, AbsHat0Y, Pressed(state, DpadDown) - Pressed(state, DpadUp));
    }

    private static int Pressed(GamepadState state, ushort mask) => (state.Buttons & mask) != 0 ? 1 : 0;

    private sealed class VirtualGamepad(LinuxInputSender.UinputDevice device, ILogger logger) : IVirtualGamepad
    {
        private bool disposed;

        // Unveraenderte Werte verwirft der Kernel selbst, deshalb geht jedes Mal der volle Stand raus.
        public void Update(GamepadState state)
        {
            ObjectDisposedException.ThrowIf(disposed, this);

            foreach (var (type, code, value) in ToEvents(state))
            {
                device.WriteEvent(type, code, value);
            }

            device.Sync();
        }

        // Beim Entfernen des Geraets laesst der Kernel noch gedrueckte Tasten selbst los.
        public void Dispose()
        {
            if (disposed)
            {
                return;
            }

            disposed = true;
            device.Dispose();
            logger.LogInformation("Virtual Xbox controller disconnected.");
        }
    }
}
