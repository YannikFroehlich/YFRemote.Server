using System.ComponentModel;
using System.Runtime.InteropServices;

namespace YFRemote.Server.Services;

public sealed class WindowsInputSender
{
    private const uint InputMouse = 0;
    private const uint InputKeyboard = 1;

    private readonly object syncRoot = new();

    public void ExecuteSynchronized(Action action)
    {
        lock (syncRoot)
        {
            action();
        }
    }

    public void SendKeyboardInput(ushort virtualKey, bool keyUp)
    {
        var input = new Input
        {
            Type = InputKeyboard,
            Data = new InputUnion
            {
                Keyboard = new KeyboardInput
                {
                    VirtualKey = virtualKey,
                    Flags = keyUp ? WindowsInputFlags.KeyEventKeyUp : 0
                }
            }
        };

        SendSingle(input, $"keyboard virtual key 0x{virtualKey:X2}");
    }

    public void SendMouseInput(int dx, int dy, int mouseData, uint flags)
    {
        var input = new Input
        {
            Type = InputMouse,
            Data = new InputUnion
            {
                Mouse = new MouseInput
                {
                    Dx = dx,
                    Dy = dy,
                    MouseData = mouseData,
                    Flags = flags
                }
            }
        };

        SendSingle(input, $"mouse flags 0x{flags:X}");
    }

    private static void SendSingle(Input input, string description)
    {
        var sent = SendInput(1, [input], Marshal.SizeOf<Input>());
        if (sent != 1)
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                $"SendInput failed for {description}.");
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint inputCount, Input[] inputs, int inputSize);

    [StructLayout(LayoutKind.Sequential)]
    private struct Input
    {
        public uint Type;

        public InputUnion Data;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)]
        public MouseInput Mouse;

        [FieldOffset(0)]
        public KeyboardInput Keyboard;

        [FieldOffset(0)]
        public HardwareInput Hardware;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int Dx;

        public int Dy;

        public int MouseData;

        public uint Flags;

        public uint Time;

        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort VirtualKey;

        public ushort ScanCode;

        public uint Flags;

        public uint Time;

        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HardwareInput
    {
        public uint Message;

        public ushort ParamLow;

        public ushort ParamHigh;
    }
}

internal static class WindowsInputFlags
{
    public const uint KeyEventKeyUp = 0x0002;

    public const uint MouseEventMove = 0x0001;
    public const uint MouseEventLeftDown = 0x0002;
    public const uint MouseEventLeftUp = 0x0004;
    public const uint MouseEventRightDown = 0x0008;
    public const uint MouseEventRightUp = 0x0010;
    public const uint MouseEventWheel = 0x0800;
}
