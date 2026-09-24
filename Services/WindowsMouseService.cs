using System.ComponentModel;
using System.Runtime.InteropServices;

namespace YFRemote.Server.Services;

public sealed class WindowsMouseService(WindowsInputSender inputSender) : IMouseService
{
    private const int SmXVirtualScreen = 76;
    private const int SmYVirtualScreen = 77;
    private const int SmCxVirtualScreen = 78;
    private const int SmCyVirtualScreen = 79;
    private static readonly IntPtr DpiAwarenessContextPerMonitorAwareV2 = -4;

    // Relative SendInput-Bewegungen laufen durch "Zeigerbeschleunigung verbessern" - zusaetzlich
    // zur eigenen Beschleunigung des Clients. Gemessen landeten 200 gesendete Einheiten je nach
    // Schrittgroesse bei 142 bis 645 px. Absolut von der aktuellen Position aus gesetzt, kommt das
    // Delta 1:1 in Pixeln an.
    public void MoveRelative(int deltaX, int deltaY)
    {
        inputSender.ExecuteSynchronized(() =>
        {
            // Physische Pixel unabhaengig davon, wie DPI-bewusst der Prozess ist - sonst passen
            // Cursorposition und virtueller Bildschirm bei gemischter Skalierung nicht zusammen.
            var previousDpiContext = SetThreadDpiAwarenessContext(DpiAwarenessContextPerMonitorAwareV2);
            try
            {
                if (!GetCursorPos(out var cursor))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "GetCursorPos failed.");
                }

                var left = GetSystemMetrics(SmXVirtualScreen);
                var top = GetSystemMetrics(SmYVirtualScreen);
                var width = GetSystemMetrics(SmCxVirtualScreen);
                var height = GetSystemMetrics(SmCyVirtualScreen);
                var x = Math.Clamp(cursor.X + deltaX, left, left + width - 1);
                var y = Math.Clamp(cursor.Y + deltaY, top, top + height - 1);

                inputSender.SendMouseInput(
                    ToAbsoluteCoordinate(x - left, width),
                    ToAbsoluteCoordinate(y - top, height),
                    mouseData: 0,
                    WindowsInputFlags.MouseEventMove | WindowsInputFlags.MouseEventAbsolute | WindowsInputFlags.MouseEventVirtualDesk);
            }
            finally
            {
                SetThreadDpiAwarenessContext(previousDpiContext);
            }
        });
    }

    public void ClickLeft() =>
        Click(WindowsInputFlags.MouseEventLeftDown, WindowsInputFlags.MouseEventLeftUp);

    public void ClickRight() =>
        Click(WindowsInputFlags.MouseEventRightDown, WindowsInputFlags.MouseEventRightUp);

    public void ClickMiddle() =>
        Click(WindowsInputFlags.MouseEventMiddleDown, WindowsInputFlags.MouseEventMiddleUp);

    public void ButtonDown(string button) =>
        SendButtonFlag(button, WindowsInputFlags.MouseEventLeftDown, WindowsInputFlags.MouseEventRightDown, WindowsInputFlags.MouseEventMiddleDown);

    public void ButtonUp(string button) =>
        SendButtonFlag(button, WindowsInputFlags.MouseEventLeftUp, WindowsInputFlags.MouseEventRightUp, WindowsInputFlags.MouseEventMiddleUp);

    public void Scroll(int delta)
    {
        inputSender.ExecuteSynchronized(() =>
            inputSender.SendMouseInput(dx: 0, dy: 0, mouseData: delta, WindowsInputFlags.MouseEventWheel));
    }

    public void ScrollHorizontal(int delta)
    {
        inputSender.ExecuteSynchronized(() =>
            inputSender.SendMouseInput(dx: 0, dy: 0, mouseData: delta, WindowsInputFlags.MouseEventHWheel));
    }

    private void SendButtonFlag(string button, uint leftFlag, uint rightFlag, uint middleFlag)
    {
        var flag = button switch
        {
            "left" => leftFlag,
            "right" => rightFlag,
            "middle" => middleFlag,
            _ => throw new ArgumentException($"Unsupported mouse button: {button}", nameof(button))
        };

        inputSender.ExecuteSynchronized(() =>
            inputSender.SendMouseInput(dx: 0, dy: 0, mouseData: 0, flag));
    }

    private void Click(uint downFlag, uint upFlag)
    {
        var downSent = false;
        Exception? failure = null;

        inputSender.ExecuteSynchronized(() =>
        {
            try
            {
                inputSender.SendMouseInput(dx: 0, dy: 0, mouseData: 0, downFlag);
                downSent = true;
            }
            catch (Exception ex)
            {
                failure = ex;
            }
            finally
            {
                if (downSent)
                {
                    try
                    {
                        inputSender.SendMouseInput(dx: 0, dy: 0, mouseData: 0, upFlag);
                    }
                    catch (Exception ex)
                    {
                        failure ??= ex;
                    }
                }
            }
        });

        if (failure is not null)
        {
            throw failure;
        }
    }

    // Windows rechnet den Bereich 0..65535 per (Wert * Groesse) / 65536 in Pixel zurueck;
    // aufgerundet landet jede Koordinate genau auf dem gewuenschten Pixel statt eins daneben.
    internal static int ToAbsoluteCoordinate(int offset, int size) =>
        (int)(((long)offset * 65536 + size - 1) / size);

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;

        public int Y;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out Point point);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll")]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
}
