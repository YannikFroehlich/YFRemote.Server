using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Linux braucht dafuer keinen Treiber: uinput legt jeden Controller als eigenes Eingabegeraet an.
// Es meldet sich mit der USB-ID und den Tasten-/Achsencodes eines kabelgebundenen Xbox-360-Controllers
// unter dem Kerneltreiber xpad, damit SDL, Steam und Proton es ohne eigenes Mapping erkennen.
// Vibration: Das Geraet meldet FF_RUMBLE an, ein Lese-Thread je Controller beantwortet die
// Force-Feedback-Uploads des Spiels (UI_BEGIN_FF_UPLOAD) und meldet Start und Stopp der Effekte.
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
            id: Xbox360Id,
            rumble: true);
        logger.LogInformation("Virtual Xbox controller connected.");
        return new VirtualGamepad(device, onRumble, logger);
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

    // Was das Spiel gerade vibrieren laesst. Liefert nur dann einen Wert, wenn sich die Vibration
    // aendert - wie die Entprellung in WindowsGamepadService.
    // ponytail: nur ein Effekt zugleich, der zuletzt gestartete gewinnt (Spiele ueber SDL nutzen
    // genau einen); mehrere ueberlagern, falls ein Spiel das braucht.
    internal sealed class RumbleEffects
    {
        private readonly Dictionary<int, FfEffect> effects = [];
        private int playing = -1;
        private long stopAt;
        private GamepadRumble last = new(0, 0);

        public GamepadRumble? Upload(FfEffect effect)
        {
            effects[effect.Id] = effect;
            return effect.Id == playing ? Changed(ToRumble(effect)) : null;
        }

        public GamepadRumble? Erase(int id)
        {
            effects.Remove(id);
            return id == playing ? Stop() : null;
        }

        public GamepadRumble? Play(int id, int value, long nowMilliseconds)
        {
            if (value <= 0 || !effects.TryGetValue(id, out var effect))
            {
                return id == playing ? Stop() : null;
            }

            playing = id;
            stopAt = effect.LengthMilliseconds == 0 ? long.MaxValue : nowMilliseconds + effect.LengthMilliseconds;
            return Changed(ToRumble(effect));
        }

        // Ein echter Controller beendet einen Effekt nach replay.length selbst, uinput nicht.
        public GamepadRumble? Tick(long nowMilliseconds) =>
            playing >= 0 && nowMilliseconds >= stopAt ? Stop() : null;

        private GamepadRumble? Stop()
        {
            playing = -1;
            return Changed(new GamepadRumble(0, 0));
        }

        private GamepadRumble? Changed(GamepadRumble rumble)
        {
            if (rumble == last)
            {
                return null;
            }

            last = rumble;
            return rumble;
        }

        // Starker Motor = grosser Motor wie bei xpad; evdev zaehlt bis 65535, XInput bis 255.
        private static GamepadRumble ToRumble(FfEffect effect) => effect.IsRumble
            ? new GamepadRumble((byte)(effect.Strong >> 8), (byte)(effect.Weak >> 8))
            : new GamepadRumble(0, 0);
    }

    private sealed class VirtualGamepad : IVirtualGamepad
    {
        private const int ReadTimeoutMilliseconds = 50;

        private readonly LinuxInputSender.UinputDevice device;
        private readonly Action<GamepadRumble> onRumble;
        private readonly ILogger logger;
        private readonly RumbleEffects rumbleEffects = new();
        private readonly Thread reader;
        private volatile bool disposed;

        public VirtualGamepad(LinuxInputSender.UinputDevice device, Action<GamepadRumble> onRumble, ILogger logger)
        {
            this.device = device;
            this.onRumble = onRumble;
            this.logger = logger;
            reader = new Thread(ReadRumble) { IsBackground = true, Name = "YFRemote gamepad rumble" };
            reader.Start();
        }

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
            reader.Join();
            device.Dispose();
            logger.LogInformation("Virtual Xbox controller disconnected.");
        }

        private void ReadRumble()
        {
            try
            {
                while (!disposed)
                {
                    var now = Environment.TickCount64;
                    if (device.TryReadEvent(ReadTimeoutMilliseconds, out var inputEvent))
                    {
                        Report(inputEvent switch
                        {
                            (LinuxInputSender.EvUinput, LinuxInputSender.UiFfUpload, var request) =>
                                rumbleEffects.Upload(device.AcknowledgeFfUpload(request)),
                            (LinuxInputSender.EvUinput, LinuxInputSender.UiFfErase, var request) =>
                                rumbleEffects.Erase(device.AcknowledgeFfErase(request)),
                            (LinuxInputSender.EvFf, var id, var value) => rumbleEffects.Play(id, value, now),
                            _ => null,
                        });
                    }

                    Report(rumbleEffects.Tick(now));
                }
            }
            catch (Exception exception)
            {
                // Der Controller selbst laeuft ohne Vibration weiter.
                logger.LogWarning(exception, "Reading controller rumble failed.");
            }
        }

        private void Report(GamepadRumble? rumble)
        {
            if (rumble is not null)
            {
                onRumble(rumble);
            }
        }
    }
}
