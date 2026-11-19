using System.Runtime.InteropServices;
using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// InjectTouchInput (ab Windows 8, auch ohne Touchscreen): bis zu 10 Finger in physischen Pixeln wie
// die Bildschirmaufnahme. Jede Meldung ist der ganze Zustand; neue Ids gehen als DOWN, bekannte als
// UPDATE, fehlende als UP hinaus. Ein still liegender Finger braucht trotzdem laufend UPDATE-Frames,
// sonst bricht Windows den Kontakt ab - das uebernimmt der Takt alle 100 ms. Der Stift laeuft ueber ein
// synthetisches Stiftgeraet (InjectSyntheticPointerInput, ab Windows 10 1809) mit Druck und Neigung.
public sealed class WindowsTouchService : ITouchService, IDisposable
{
    internal const int MaxContacts = 10;
    private static readonly TimeSpan KeepAliveInterval = TimeSpan.FromMilliseconds(100);
    private static readonly IntPtr DpiAwarenessContextPerMonitorAwareV2 = -4;

    private readonly WindowsInputSender inputSender;
    private readonly object gate = new();
    private readonly Dictionary<int, (int X, int Y)> contacts = [];
    private readonly System.Threading.Timer keepAlive;
    private bool initialized;
    private IntPtr penDevice;
    private (int X, int Y, PenState State)? pen;
    private long lastInjectTicks;

    public WindowsTouchService(WindowsInputSender inputSender)
    {
        this.inputSender = inputSender;
        keepAlive = new System.Threading.Timer(_ => KeepAlive(), null, KeepAliveInterval, KeepAliveInterval);
    }

    public void Apply(IReadOnlyList<TouchPoint> points, string? monitor)
    {
        lock (gate)
        {
            EnsureInitialized();
            var previousDpiContext = SetThreadDpiAwarenessContext(DpiAwarenessContextPerMonitorAwareV2);
            try
            {
                var screen = WindowsMonitors.Find(monitor);
                var next = points.ToDictionary(
                    point => point.Id,
                    point => (
                        screen.Left + Math.Min((int)(point.X * screen.Width), screen.Width - 1),
                        screen.Top + Math.Min((int)(point.Y * screen.Height), screen.Height - 1)));
                var frame = new List<PointerTouchInfo>();
                foreach (var (id, position) in contacts)
                {
                    if (!next.ContainsKey(id))
                    {
                        frame.Add(Contact(id, position, PointerFlagUp));
                    }
                }

                foreach (var (id, position) in next)
                {
                    frame.Add(Contact(id, position, contacts.ContainsKey(id) ? HeldFlags | PointerFlagUpdate : HeldFlags | PointerFlagDown));
                }

                contacts.Clear();
                foreach (var (id, position) in next)
                {
                    contacts[id] = position;
                }

                Inject(frame);
            }
            finally
            {
                SetThreadDpiAwarenessContext(previousDpiContext);
            }
        }
    }

    public void ApplyPen(PenState? state, string? monitor)
    {
        lock (gate)
        {
            var previousDpiContext = SetThreadDpiAwarenessContext(DpiAwarenessContextPerMonitorAwareV2);
            try
            {
                if (state is null)
                {
                    LiftPen();
                    return;
                }

                var screen = WindowsMonitors.Find(monitor);
                var x = screen.Left + Math.Min((int)(state.X * screen.Width), screen.Width - 1);
                var y = screen.Top + Math.Min((int)(state.Y * screen.Height), screen.Height - 1);
                var wasInContact = pen?.State.Contact == true;
                var flags = (state.Contact, wasInContact) switch
                {
                    (true, true) => PointerFlagInContact | PointerFlagUpdate,
                    (true, false) => PointerFlagInContact | PointerFlagDown,
                    (false, true) => PointerFlagUp,
                    (false, false) => PointerFlagUpdate,
                };
                InjectPen(x, y, state, PointerFlagInRange | flags);
                pen = (x, y, state);
            }
            finally
            {
                SetThreadDpiAwarenessContext(previousDpiContext);
            }
        }
    }

    public void Dispose()
    {
        keepAlive.Dispose();
        try
        {
            lock (gate)
            {
                if (contacts.Count > 0)
                {
                    Inject([.. contacts.Select(contact => Contact(contact.Key, contact.Value, PointerFlagUp))]);
                }

                LiftPen();
            }
        }
        catch (Exception exception) when (exception is InputBlockedException or System.ComponentModel.Win32Exception)
        {
            // Beim Beenden egal.
        }
        finally
        {
            if (penDevice != IntPtr.Zero)
            {
                DestroySyntheticPointerDevice(penDevice);
                penDevice = IntPtr.Zero;
            }
        }
    }

    // Erst die Spitze abheben, dann den Stift aus der Reichweite nehmen (UPDATE ohne INRANGE).
    private void LiftPen()
    {
        if (pen is not { } last)
        {
            return;
        }

        pen = null;
        var hovering = last.State with { Contact = false, Pressure = 0 };
        if (last.State.Contact)
        {
            InjectPen(last.X, last.Y, hovering, PointerFlagInRange | PointerFlagUp);
        }

        InjectPen(last.X, last.Y, hovering, PointerFlagUpdate);
    }

    private void KeepAlive()
    {
        try
        {
            lock (gate)
            {
                if ((contacts.Count == 0 && pen?.State.Contact != true)
                    || Environment.TickCount64 - lastInjectTicks < KeepAliveInterval.TotalMilliseconds * 0.8)
                {
                    return;
                }

                if (contacts.Count > 0)
                {
                    Inject([.. contacts.Select(contact => Contact(contact.Key, contact.Value, HeldFlags | PointerFlagUpdate))]);
                }

                if (pen is { State.Contact: true } held)
                {
                    InjectPen(held.X, held.Y, held.State, HeldFlags | PointerFlagUpdate);
                }
            }
        }
        catch (Exception exception) when (exception is InputBlockedException or System.ComponentModel.Win32Exception)
        {
            // Sicherer Desktop o. ae.: Windows hat die Kontakte ohnehin verworfen.
        }
    }

    private void EnsureInitialized()
    {
        if (initialized)
        {
            return;
        }

        if (!InitializeTouchInjection(MaxContacts, TouchFeedbackDefault))
        {
            throw WindowsInputSender.LastWin32Failure("InitializeTouchInjection failed.");
        }

        initialized = true;
    }

    private void Inject(List<PointerTouchInfo> frame)
    {
        if (frame.Count == 0)
        {
            return;
        }

        var ok = false;
        inputSender.ExecuteSynchronized(() => ok = InjectTouchInput((uint)frame.Count, [.. frame]));
        lastInjectTicks = Environment.TickCount64;
        if (!ok)
        {
            // Nach einem Fehler verwirft Windows alle Kontakte; der naechste Finger beginnt neu mit DOWN.
            contacts.Clear();
            throw WindowsInputSender.LastWin32Failure("InjectTouchInput failed.");
        }
    }

    private void InjectPen(int x, int y, PenState state, uint flags)
    {
        if (penDevice == IntPtr.Zero)
        {
            penDevice = CreateSyntheticPointerDevice(PointerTypePen, 1, PointerFeedbackDefault);
            if (penDevice == IntPtr.Zero)
            {
                throw WindowsInputSender.LastWin32Failure("CreateSyntheticPointerDevice failed.");
            }
        }

        flags |= PointerFlagPrimary;
        if (state.Contact)
        {
            flags |= PointerFlagFirstButton;
        }

        if (state.Barrel)
        {
            flags |= PointerFlagSecondButton;
        }

        var penFlags = (state.Barrel ? PenFlagBarrel : 0)
            | (state.Eraser ? PenFlagInverted : 0)
            | (state.Eraser && state.Contact ? PenFlagEraser : 0);
        var info = new PointerTypeInfo
        {
            Type = PointerTypePen,
            Info = new PointerUnion
            {
                Pen = new PointerPenInfo
                {
                    PointerInfo = new PointerInfo
                    {
                        PointerType = PointerTypePen,
                        PointerFlags = flags,
                        PixelLocation = new Point(x, y),
                    },
                    PenFlags = penFlags,
                    PenMask = PenMaskPressure | PenMaskTiltX | PenMaskTiltY,
                    Pressure = (uint)Math.Round(state.Pressure * 1024),
                    TiltX = (int)Math.Round(state.TiltX),
                    TiltY = (int)Math.Round(state.TiltY),
                },
            },
        };

        var ok = false;
        inputSender.ExecuteSynchronized(() => ok = InjectSyntheticPointerInput(penDevice, [info], 1));
        lastInjectTicks = Environment.TickCount64;
        if (!ok)
        {
            // Wie bei den Fingern: nach einem Fehler beginnt der Stift neu.
            pen = null;
            throw WindowsInputSender.LastWin32Failure("InjectSyntheticPointerInput failed.");
        }
    }

    private static PointerTouchInfo Contact(int id, (int X, int Y) position, uint flags) => new()
    {
        PointerInfo = new PointerInfo
        {
            PointerType = PointerTypeTouch,
            PointerId = (uint)id,
            PointerFlags = flags,
            PixelLocation = new Point(position.X, position.Y),
        },
        TouchMask = TouchMaskContactArea | TouchMaskOrientation | TouchMaskPressure,
        Contact = new Rect(position.X - 2, position.Y - 2, position.X + 2, position.Y + 2),
        Orientation = 90,
        Pressure = 32000,
    };

    private const uint PointerTypeTouch = 2;
    private const uint PointerTypePen = 3;
    private const uint PointerFlagPrimary = 0x2000;
    private const uint PointerFlagFirstButton = 0x10;
    private const uint PointerFlagSecondButton = 0x20;
    private const uint PointerFeedbackDefault = 0x1;
    private const uint PenFlagBarrel = 0x1;
    private const uint PenFlagInverted = 0x2;
    private const uint PenFlagEraser = 0x4;
    private const uint PenMaskPressure = 0x1;
    private const uint PenMaskTiltX = 0x4;
    private const uint PenMaskTiltY = 0x8;
    private const uint PointerFlagInRange = 0x2;
    private const uint PointerFlagInContact = 0x4;
    private const uint PointerFlagDown = 0x10000;
    private const uint PointerFlagUpdate = 0x20000;
    private const uint PointerFlagUp = 0x40000;
    private const uint HeldFlags = PointerFlagInRange | PointerFlagInContact;
    private const uint TouchMaskContactArea = 0x1;
    private const uint TouchMaskOrientation = 0x2;
    private const uint TouchMaskPressure = 0x4;
    private const uint TouchFeedbackDefault = 0x1;

    [StructLayout(LayoutKind.Sequential)]
    private readonly record struct Point(int X, int Y);

    [StructLayout(LayoutKind.Sequential)]
    private readonly record struct Rect(int Left, int Top, int Right, int Bottom);

    [StructLayout(LayoutKind.Sequential)]
    private struct PointerInfo
    {
        public uint PointerType;
        public uint PointerId;
        public uint FrameId;
        public uint PointerFlags;
        public IntPtr SourceDevice;
        public IntPtr HwndTarget;
        public Point PixelLocation;
        public Point HimetricLocation;
        public Point PixelLocationRaw;
        public Point HimetricLocationRaw;
        public uint Time;
        public uint HistoryCount;
        public int InputData;
        public uint KeyStates;
        public ulong PerformanceCount;
        public int ButtonChangeType;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PointerTouchInfo
    {
        public PointerInfo PointerInfo;
        public uint TouchFlags;
        public uint TouchMask;
        public Rect Contact;
        public Rect ContactRaw;
        public uint Orientation;
        public uint Pressure;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PointerPenInfo
    {
        public PointerInfo PointerInfo;
        public uint PenFlags;
        public uint PenMask;
        public uint Pressure;
        public uint Rotation;
        public int TiltX;
        public int TiltY;
    }

    // POINTER_TYPE_INFO: die Union ist so gross wie ihr groesstes Mitglied, POINTER_TOUCH_INFO.
    [StructLayout(LayoutKind.Explicit)]
    private struct PointerUnion
    {
        [FieldOffset(0)]
        public PointerTouchInfo Touch;

        [FieldOffset(0)]
        public PointerPenInfo Pen;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PointerTypeInfo
    {
        public uint Type;
        public PointerUnion Info;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CreateSyntheticPointerDevice(uint pointerType, uint maxCount, uint mode);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool InjectSyntheticPointerInput(IntPtr device, [In] PointerTypeInfo[] pointerInfo, uint count);

    [DllImport("user32.dll")]
    private static extern void DestroySyntheticPointerDevice(IntPtr device);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool InitializeTouchInjection(uint maxCount, uint feedbackMode);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool InjectTouchInput(uint count, [In] PointerTouchInfo[] contacts);

    [DllImport("user32.dll")]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
}
