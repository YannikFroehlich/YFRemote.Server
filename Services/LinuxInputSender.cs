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
    private const ushort EvKey = 0x01;
    private const ushort EvRel = 0x02;
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

    private sealed class UinputDevice : IDisposable
    {
        private const int OWronly = 0x0001;
        private const int ONonblock = 0x0800;

        private const uint UiDevCreate = 0x5501;
        private const uint UiDevDestroy = 0x5502;
        private const uint UiSetEvBit = 0x40045564;
        private const uint UiSetKeyBit = 0x40045565;
        private const uint UiSetRelBit = 0x40045566;

        private const int UinputMaxNameSize = 80;
        private const int AbsCnt = 64;
        private const int UinputUserDevSize = UinputMaxNameSize + 8 + 4 + (4 * AbsCnt * 4);
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
            IReadOnlyCollection<ushort>? relCodes = null)
        {
            var fd = open("/dev/uinput", OWronly | ONonblock);
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

                device.WriteDeviceDescriptor(name);
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

        private void WriteDeviceDescriptor(string name)
        {
            var buffer = new byte[UinputUserDevSize];
            var nameBytes = Encoding.ASCII.GetBytes(name);
            var nameLength = Math.Min(nameBytes.Length, UinputMaxNameSize - 1);
            nameBytes.AsSpan(0, nameLength).CopyTo(buffer);

            // struct input_id direkt hinter dem Namen: bustype, vendor, product, version (je
            // u16). vendor/product/version bleiben 0 - rein virtuelles Geraet ohne echte
            // PCI-/USB-ID. absmax/absmin/absfuzz/absflat bleiben 0, da keine ABS-Achsen
            // benutzt werden (nur Tasten und relative Mausbewegung).
            BitConverter.TryWriteBytes(buffer.AsSpan(UinputMaxNameSize, 2), BusUsb);

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
    }
}
