using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace YFRemote.Server.Services;

public sealed class WindowsWindowService(WindowsInputSender inputSender) : IWindowService
{
    private const int GwOwner = 4;
    private const int GwlExStyle = -20;
    private const long WsExToolWindow = 0x80;
    private const long WsExAppWindow = 0x40000;
    private const long WsExNoActivate = 0x08000000;
    private const int DwmwaCloaked = 14;
    private const int SwRestore = 9;
    private const int SwMinimize = 6;
    private const uint WmClose = 0x10;

    // Wie Alt+Tab: sichtbar, ohne Besitzer, kein Werkzeugfenster, nicht aktivierbare Fenster nur mit
    // WS_EX_APPWINDOW (sonst kaemen Hilfsfenster wie Parsecs 1x1-Overlay mit), mit Titel und nicht
    // "cloaked" - so heissen unsichtbare Store-App-Fenster und Fenster auf anderen virtuellen Desktops.
    public IReadOnlyList<OpenWindow> ListWindows()
    {
        var ownProcess = (uint)Environment.ProcessId;
        var windows = new List<OpenWindow>();
        EnumWindows((handle, _) =>
        {
            if (IsWindowVisible(handle)
                && GetWindow(handle, GwOwner) == 0
                && IsAltTabStyle((long)GetWindowLongPtr(handle, GwlExStyle))
                && !IsCloaked(handle)
                && GetWindowThreadProcessId(handle, out var processId) != 0
                && processId != ownProcess
                && Title(handle) is { Length: > 0 } title)
            {
                windows.Add(new OpenWindow(
                    ((long)handle).ToString(CultureInfo.InvariantCulture),
                    title,
                    WindowsMediaStatusReader.ProcessName((int)processId)));
            }

            return true;
        }, 0);

        return windows;
    }

    public bool TryApply(string id, WindowCommand command)
    {
        if (!ListWindows().Any(window => window.Id == id))
        {
            return false;
        }

        var handle = (nint)long.Parse(id, CultureInfo.InvariantCulture);
        switch (command)
        {
            case WindowCommand.Minimize:
                ShowWindow(handle, SwMinimize);
                break;
            // Wie das X am Fenster: die App darf noch nach ungespeicherten Aenderungen fragen. Fenster
            // eines Prozesses mit Adminrechten nehmen die Nachricht nicht an.
            case WindowCommand.Close when !PostMessage(handle, WmClose, 0, 0):
                throw new InvalidOperationException("Windows refused to close this window.");
            case WindowCommand.Close:
                break;
            default:
                Focus(handle);
                break;
        }

        return true;
    }

    private void Focus(nint handle)
    {
        if (IsIconic(handle))
        {
            ShowWindow(handle, SwRestore);
        }

        // Windows gibt den Vordergrund nur dem Prozess, von dem die letzte Eingabe kam. Eine
        // Mausbewegung um 0 Pixel genuegt dafuer (so macht es auch PowerToys) und bewegt nichts.
        inputSender.ExecuteSynchronized(() =>
            inputSender.SendMouseInput(0, 0, 0, WindowsInputFlags.MouseEventMove));
        if (!SetForegroundWindow(handle))
        {
            throw new InvalidOperationException("Windows refused to bring this window to the front.");
        }
    }

    internal static bool IsAltTabStyle(long extendedStyle) =>
        (extendedStyle & WsExToolWindow) == 0
        && ((extendedStyle & WsExNoActivate) == 0 || (extendedStyle & WsExAppWindow) != 0);

    private static bool IsCloaked(nint handle) =>
        DwmGetWindowAttribute(handle, DwmwaCloaked, out var cloaked, sizeof(int)) == 0 && cloaked != 0;

    private static string Title(nint handle)
    {
        var length = GetWindowTextLength(handle);
        if (length == 0)
        {
            return "";
        }

        var buffer = new StringBuilder(length + 1);
        GetWindowText(handle, buffer, buffer.Capacity);
        return buffer.ToString().Trim();
    }

    private delegate bool EnumWindowsProc(nint handle, nint parameter);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsProc callback, nint parameter);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(nint handle);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(nint handle);

    [DllImport("user32.dll")]
    private static extern nint GetWindow(nint handle, int command);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern nint GetWindowLongPtr(nint handle, int index);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(nint handle, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(nint handle);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(nint handle, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(nint handle, int command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(nint handle);

    [DllImport("user32.dll", EntryPoint = "PostMessageW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessage(nint handle, uint message, nint wParam, nint lParam);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(nint handle, int attribute, out int value, int size);
}
