using System.Runtime.InteropServices;
using System.Text;

namespace YFRemote.Server.Services;

// P/Invoke auf libc fuer /dev/uinput: meldet ein virtuelles Tastatur- und ein virtuelles
// Mausgeraet im Kernel an, deren Events unterhalb von X11/Wayland ununterscheidbar von
// echter Hardware sind (siehe AGENTS.md "Linux support"). Serialisiert alle Sendevorgaenge
// hinter einem Lock, analog zu WindowsInputSender.ExecuteSynchronized, damit
// Modifier-Reihenfolge bei Hotkeys nicht verschraenkt und keine Taste haengen bleibt.
//
// Die Geraete werden erst beim ersten tatsaechlichen Sendevorgang angelegt, nicht im
// Konstruktor: so bleiben ExecuteSynchronized selbst und jede Validierung, die vor dem
// eigentlichen Senden wirft (z.B. UnsupportedKeyException), ohne /dev/uinput testbar.
public sealed class LinuxInputSender : IDisposable
{
    public const ushort BtnLeft = 0x110;
    public const ushort BtnRight = 0x111;
    public const ushort BtnMiddle = 0x112;

    private const ushort EvSyn = 0x00;
    internal const ushort EvKey = 0x01;
    private const ushort EvRel = 0x02;
    internal const ushort EvAbs = 0x03;
    internal const ushort EvFf = 0x15;
    // Kein Hardware-Ereignis: so reicht uinput die Force-Feedback-Anfragen eines Spiels durch.
    internal const ushort EvUinput = 0x0101;
    internal const ushort UiFfUpload = 1;
    internal const ushort UiFfErase = 2;
    private const ushort SynReport = 0x00;
    private const ushort RelX = 0x00;
    private const ushort RelY = 0x01;
    private const ushort RelHWheel = 0x06;
    private const ushort RelWheel = 0x08;

    private readonly object syncRoot = new();
    private UinputDevice? keyboard;
    private UinputDevice? mouse;

    public void ExecuteSynchronized(Action action)
    {
        lock (syncRoot)
        {
            action();
        }
    }

    public void SendKey(ushort keyCode, bool keyUp)
    {
        var device = EnsureKeyboard();
        device.WriteEvent(EvKey, keyCode, keyUp ? 0 : 1);
        device.Sync();
    }

    public void SendMouseButton(ushort buttonCode, bool down)
    {
        var device = EnsureMouse();
        device.WriteEvent(EvKey, buttonCode, down ? 1 : 0);
        device.Sync();
    }

    public void SendMouseMove(int deltaX, int deltaY)
    {
        var device = EnsureMouse();

        if (deltaX != 0)
        {
            device.WriteEvent(EvRel, RelX, deltaX);
        }

        if (deltaY != 0)
        {
            device.WriteEvent(EvRel, RelY, deltaY);
        }

        device.Sync();
    }

    public void SendMouseWheel(int value, bool horizontal)
    {
        var device = EnsureMouse();
        device.WriteEvent(EvRel, horizontal ? RelHWheel : RelWheel, value);
        device.Sync();
    }

    public void Dispose()
    {
        keyboard?.Dispose();
        mouse?.Dispose();
    }

    private UinputDevice EnsureKeyboard() =>
        keyboard ??= UinputDevice.Create("YFRemote Virtual Keyboard", LinuxInputService.AllKeyCodes);

    private UinputDevice EnsureMouse() =>
        mouse ??= UinputDevice.Create(
            "YFRemote Virtual Mouse",
            keyCodes: [BtnLeft, BtnRight, BtnMiddle],
            relCodes: [RelX, RelY, RelWheel, RelHWheel]);

    internal sealed class UinputDevice : IDisposable
    {
        private const int OWronly = 0x0001;
        private const int ORdwr = 0x0002;
        private const int ONonblock = 0x0800;

        private const uint UiDevCreate = 0x5501;
        private const uint UiDevDestroy = 0x5502;
        private const uint UiSetEvBit = 0x40045564;
        private const uint UiSetKeyBit = 0x40045565;
        private const uint UiSetRelBit = 0x40045566;
        private const uint UiSetAbsBit = 0x40045567;
        private const uint UiSetFfBit = 0x4004556B;
        // _IOWR/_IOW('U', 200..203) ueber struct uinput_ff_upload (104 Byte) und uinput_ff_erase (12).
        private const uint UiBeginFfUpload = 0xC06855C8;
        private const uint UiEndFfUpload = 0x406855C9;
        private const uint UiBeginFfErase = 0xC00C55CA;
        private const uint UiEndFfErase = 0x400C55CB;
        private const int FfUploadSize = 104;
        private const int FfEraseSize = 12;
        private const ushort FfRumble = 0x50;
        private const int FfEffectsMax = 16;
        private const short PollIn = 0x0001;

        private const int UinputMaxNameSize = 80;
        private const int AbsCnt = 64;
        // name[80], struct input_id (4 x u16), u32 ff_effects_max, dann je int[64] absmax,
        // absmin, absfuzz, absflat.
        private const int FfEffectsMaxOffset = UinputMaxNameSize + 8;
        private const int AbsMaxOffset = FfEffectsMaxOffset + 4;
        private const int AbsArraySize = AbsCnt * 4;
        private const int UinputUserDevSize = AbsMaxOffset + (4 * AbsArraySize);
        private const ushort BusUsb = 0x03;

        // ponytail: fester Wert statt auf das Erscheinen des Geraets zu warten (waere
        // inotify auf /dev/input); reicht die Zeit auf einem traegen Desktop nicht, hier erhoehen.
        private const int DeviceSettleMilliseconds = 500;

        // struct input_event auf 64-Bit-Linux (x64/arm64): timeval{long,long} + u16 type +
        // u16 code + s32 value = 24 Byte, ohne zusaetzliches Padding.
        private const int InputEventSize = 24;

        private readonly int fd;

        private UinputDevice(int fd)
        {
            this.fd = fd;
        }

        public static UinputDevice Create(
            string name,
            IReadOnlyCollection<ushort> keyCodes,
            IReadOnlyCollection<ushort>? relCodes = null,
            IReadOnlyCollection<UinputAbsAxis>? absAxes = null,
            UinputId id = default,
            bool rumble = false)
        {
            // Vibration kommt als Ereignis vom Kernel zurueck, dafuer muss das Geraet lesbar sein.
            var fd = open("/dev/uinput", (rumble ? ORdwr : OWronly) | ONonblock);
            if (fd < 0)
            {
                throw new InvalidOperationException(
                    $"/dev/uinput konnte nicht geoeffnet werden (errno {Marshal.GetLastPInvokeError()}). " +
                    "Ist das Kernelmodul geladen (modprobe uinput) und der Dienstbenutzer in der Gruppe 'input'?");
            }

            var device = new UinputDevice(fd);

            try
            {
                device.SetEvBit(EvKey);
                foreach (var keyCode in keyCodes)
                {
                    device.CheckedIoctl(UiSetKeyBit, keyCode);
                }

                if (relCodes is { Count: > 0 })
                {
                    device.SetEvBit(EvRel);
                    foreach (var relCode in relCodes)
                    {
                        device.CheckedIoctl(UiSetRelBit, relCode);
                    }
                }

                if (absAxes is { Count: > 0 })
                {
                    device.SetEvBit(EvAbs);
                    foreach (var axis in absAxes)
                    {
                        device.CheckedIoctl(UiSetAbsBit, axis.Code);
                    }
                }

                if (rumble)
                {
                    device.SetEvBit(EvFf);
                    device.CheckedIoctl(UiSetFfBit, FfRumble);
                }

                device.WriteDeviceDescriptor(name, id, absAxes ?? [], rumble ? FfEffectsMax : 0);
                device.CheckedIoctl(UiDevCreate, 0, "Geraet konnte nicht angelegt werden");
                // X11/libinput oeffnen ein neues Geraet erst einen Moment nach UI_DEV_CREATE;
                // Events, die sofort danach kommen, gehen verloren (auf einer Mint-VM fehlte der
                // ganze erste Text nach dem Serverstart). Gilt nur fuer den ersten Sendevorgang.
                Thread.Sleep(DeviceSettleMilliseconds);
            }
            catch
            {
                device.Dispose();
                throw;
            }

            return device;
        }

        public void WriteEvent(ushort type, ushort code, int value)
        {
            var buffer = new byte[InputEventSize];
            // Byte 0..15 (timeval) bleiben 0 - der Kernel setzt den Zeitstempel selbst.
            BitConverter.TryWriteBytes(buffer.AsSpan(16, 2), type);
            BitConverter.TryWriteBytes(buffer.AsSpan(18, 2), code);
            BitConverter.TryWriteBytes(buffer.AsSpan(20, 4), value);
            WriteAll(buffer);
        }

        public void Sync() => WriteEvent(EvSyn, SynReport, 0);

        // Wartet hoechstens timeoutMilliseconds auf ein Ereignis, das der Kernel an das Geraet schickt.
        public bool TryReadEvent(int timeoutMilliseconds, out (ushort Type, ushort Code, int Value) inputEvent)
        {
            inputEvent = default;
            var pollFd = new PollFd { Fd = fd, Events = PollIn };
            if (poll(ref pollFd, 1, timeoutMilliseconds) <= 0)
            {
                return false;
            }

            var buffer = new byte[InputEventSize];
            if (read(fd, buffer, (nuint)buffer.Length) != buffer.Length)
            {
                return false;
            }

            inputEvent = (
                BitConverter.ToUInt16(buffer, 16),
                BitConverter.ToUInt16(buffer, 18),
                BitConverter.ToInt32(buffer, 20));
            return true;
        }

        // Das Spiel haengt in seinem ioctl, bis beide Schritte durch sind (der Kernel wartet 30 s).
        public FfEffect AcknowledgeFfUpload(int requestId)
        {
            var buffer = new byte[FfUploadSize];
            BitConverter.TryWriteBytes(buffer.AsSpan(0, 4), requestId);
            CheckedIoctl(UiBeginFfUpload, buffer);
            var effect = ParseFfUpload(buffer);
            // retval (Byte 4..7) bleibt 0: Effekt angenommen.
            CheckedIoctl(UiEndFfUpload, buffer);
            return effect;
        }

        public int AcknowledgeFfErase(int requestId)
        {
            var buffer = new byte[FfEraseSize];
            BitConverter.TryWriteBytes(buffer.AsSpan(0, 4), requestId);
            CheckedIoctl(UiBeginFfErase, buffer);
            CheckedIoctl(UiEndFfErase, buffer);
            return BitConverter.ToInt32(buffer, 8);
        }

        // struct uinput_ff_upload: u32 request_id, s32 retval, dann struct ff_effect ab Byte 8
        // (u16 type, s16 id, u16 direction, ff_trigger, ff_replay{u16 length, u16 delay}, 2 Byte
        // Padding, Union ab Byte 16 mit ff_rumble_effect{u16 strong, u16 weak}).
        internal static FfEffect ParseFfUpload(ReadOnlySpan<byte> buffer) => new(
            Id: BitConverter.ToInt16(buffer[10..]),
            IsRumble: BitConverter.ToUInt16(buffer[8..]) == FfRumble,
            LengthMilliseconds: BitConverter.ToUInt16(buffer[18..]),
            Strong: BitConverter.ToUInt16(buffer[24..]),
            Weak: BitConverter.ToUInt16(buffer[26..]));

        public void Dispose()
        {
            ioctl(fd, UiDevDestroy, 0);
            close(fd);
        }

        private void SetEvBit(ushort evType) => CheckedIoctl(UiSetEvBit, evType);

        private void CheckedIoctl(uint request, int arg, string? failureContext = null)
        {
            if (ioctl(fd, request, arg) < 0)
            {
                var suffix = failureContext is null ? string.Empty : $": {failureContext}";
                throw new InvalidOperationException(
                    $"uinput-ioctl 0x{request:X} fuer Wert {arg} fehlgeschlagen " +
                    $"(errno {Marshal.GetLastPInvokeError()}){suffix}.");
            }
        }

        private void CheckedIoctl(uint request, byte[] buffer)
        {
            if (ioctl(fd, request, buffer) < 0)
            {
                throw new InvalidOperationException(
                    $"uinput-ioctl 0x{request:X} fehlgeschlagen (errno {Marshal.GetLastPInvokeError()}).");
            }
        }

        private void WriteDeviceDescriptor(
            string name,
            UinputId id,
            IReadOnlyCollection<UinputAbsAxis> absAxes,
            int ffEffectsMax)
        {
            var buffer = new byte[UinputUserDevSize];
            var nameBytes = Encoding.ASCII.GetBytes(name);
            var nameLength = Math.Min(nameBytes.Length, UinputMaxNameSize - 1);
            nameBytes.AsSpan(0, nameLength).CopyTo(buffer);

            // struct input_id direkt hinter dem Namen: bustype, vendor, product, version (je
            // u16). Tastatur und Maus lassen vendor/product/version auf 0 - rein virtuelle
            // Geraete ohne echte USB-ID; nur der Controller gibt sich als Xbox 360 aus.
            BitConverter.TryWriteBytes(buffer.AsSpan(UinputMaxNameSize, 2), BusUsb);
            BitConverter.TryWriteBytes(buffer.AsSpan(UinputMaxNameSize + 2, 2), id.Vendor);
            BitConverter.TryWriteBytes(buffer.AsSpan(UinputMaxNameSize + 4, 2), id.Product);
            BitConverter.TryWriteBytes(buffer.AsSpan(UinputMaxNameSize + 6, 2), id.Version);

            BitConverter.TryWriteBytes(buffer.AsSpan(FfEffectsMaxOffset, 4), ffEffectsMax);

            foreach (var axis in absAxes)
            {
                var offset = AbsMaxOffset + (axis.Code * 4);
                BitConverter.TryWriteBytes(buffer.AsSpan(offset, 4), axis.Max);
                BitConverter.TryWriteBytes(buffer.AsSpan(offset + AbsArraySize, 4), axis.Min);
                BitConverter.TryWriteBytes(buffer.AsSpan(offset + (2 * AbsArraySize), 4), axis.Fuzz);
                BitConverter.TryWriteBytes(buffer.AsSpan(offset + (3 * AbsArraySize), 4), axis.Flat);
            }

            WriteAll(buffer);
        }

        private void WriteAll(byte[] buffer)
        {
            var written = write(fd, buffer, (nuint)buffer.Length);
            if (written != buffer.Length)
            {
                throw new InvalidOperationException(
                    "Schreiben auf /dev/uinput unvollstaendig oder fehlgeschlagen " +
                    $"(errno {Marshal.GetLastPInvokeError()}).");
            }
        }

        [DllImport("libc", EntryPoint = "open", SetLastError = true)]
        private static extern int open(string pathname, int flags);

        [DllImport("libc", EntryPoint = "close", SetLastError = true)]
        private static extern int close(int fd);

        [DllImport("libc", EntryPoint = "write", SetLastError = true)]
        private static extern nint write(int fd, byte[] buffer, nuint count);

        [DllImport("libc", EntryPoint = "ioctl", SetLastError = true)]
        private static extern int ioctl(int fd, nuint request, int arg);

        [DllImport("libc", EntryPoint = "ioctl", SetLastError = true)]
        private static extern int ioctl(int fd, nuint request, byte[] arg);

        [DllImport("libc", EntryPoint = "read", SetLastError = true)]
        private static extern nint read(int fd, byte[] buffer, nuint count);

        [DllImport("libc", EntryPoint = "poll", SetLastError = true)]
        private static extern int poll(ref PollFd fds, nuint nfds, int timeout);

        [StructLayout(LayoutKind.Sequential)]
        private struct PollFd
        {
            public int Fd;
            public short Events;
            public short Revents;
        }
    }
}

// Wertebereich einer absoluten Achse (Stick, Trigger, Steuerkreuz) fuer struct uinput_user_dev.
internal readonly record struct UinputAbsAxis(ushort Code, int Min, int Max, int Fuzz = 0, int Flat = 0);

internal readonly record struct UinputId(ushort Vendor, ushort Product, ushort Version);

// Hochgeladener Force-Feedback-Effekt eines Spiels; LengthMilliseconds 0 heisst ohne Ende.
internal readonly record struct FfEffect(short Id, bool IsRumble, ushort LengthMilliseconds, ushort Strong, ushort Weak);
