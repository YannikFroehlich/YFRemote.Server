using System.ComponentModel;
using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;

namespace YFRemote.Server.Services;

// Laeuft als SYSTEM in der Konsolen-Sitzung (gestartet von WindowsSecureDesktopService) und
// beantwortet die Pipe-Anfragen des Servers. Er handelt nur, solange der Eingabe-Desktop "Winlogon"
// ist (Sperrbildschirm, UAC-Abfrage); auf dem normalen Desktop arbeitet der Server selbst.
internal static class WindowsSecureDesktopHelper
{
    private const int MaxInputsPerRequest = 64;
    private static IntPtr currentDesktop;

    public static void Run(string allowedSid, int parentProcessId)
    {
        // Endet der Dienst ohne OnStop (abgestuerzt, getoetet), darf kein Helfer zurueckbleiben,
        // der die Pipe blockiert.
        new Thread(() =>
        {
            try
            {
                using var parent = Process.GetProcessById(parentProcessId);
                parent.WaitForExit();
            }
            catch (ArgumentException)
            {
            }

            Environment.Exit(0);
        })
        { IsBackground = true }.Start();

        Log($"Helper started in session {Process.GetCurrentProcess().SessionId}.");
        // Eigener MTA-Thread: der [STAThread]-Hauptthread hat durch COM ein verstecktes Fenster, und
        // mit einem Fenster scheitert SetThreadDesktop.
        var worker = new Thread(() => ServeLoop(allowedSid));
        worker.SetApartmentState(ApartmentState.MTA);
        worker.Start();
        worker.Join();
    }

    // Nur Fehler, damit sich auf dem sicheren Desktop nachvollziehen laesst, woran es hakt.
    internal static void Log(string message)
    {
        try
        {
            var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "YFRemote", "secure-desktop.log");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            if (new FileInfo(path) is { Exists: true, Length: > 1_000_000 } full)
            {
                full.Delete();
            }

            File.AppendAllText(path, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {message}{Environment.NewLine}");
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
        }
    }

    private static void ServeLoop(string allowedSid)
    {
        var security = new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(allowedSid), PipeAccessRights.ReadWrite, AccessControlType.Allow));
        // FirstPipeInstance: haelt schon ein anderer Prozess den Namen, nicht mitspielen. Danach liegt
        // immer schon die naechste Instanz bereit, sonst faende ein Klick zwischen zwei Anfragen keine
        // Pipe. Neue Instanzen darf nur SYSTEM anlegen (ReadWrite enthaelt CreateNewInstance nicht).
        NamedPipeServerStream? next = null;
        while (next is null)
        {
            next = CreatePipe(security, PipeOptions.FirstPipeInstance);
            if (next is null)
            {
                Thread.Sleep(2000);
            }
        }

        while (true)
        {
            using (var pipe = next)
            {
                next = null;
                try
                {
                    pipe.WaitForConnection();
                    next = CreatePipe(security, PipeOptions.None);
                    if (GetNamedPipeClientProcessId(pipe.SafePipeHandle, out var clientProcessId)
                        && WindowsSecureDesktop.IsSameExecutable(clientProcessId))
                    {
                        Serve(pipe);
                    }
                    else
                    {
                        Log($"Rejected pipe client {clientProcessId}.");
                    }
                }
                catch (Exception exception) when (exception is IOException or EndOfStreamException)
                {
                    // Server mitten in der Anfrage weg - naechste Verbindung.
                }
            }

            while (next is null)
            {
                next = CreatePipe(security, PipeOptions.None);
                if (next is null)
                {
                    Thread.Sleep(100);
                }
            }
        }
    }

    private static NamedPipeServerStream? CreatePipe(PipeSecurity security, PipeOptions options)
    {
        try
        {
            return NamedPipeServerStreamAcl.Create(
                WindowsSecureDesktop.PipeName, PipeDirection.InOut, 2, PipeTransmissionMode.Byte, options, 0, 0, security);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static void Serve(Stream pipe)
    {
        using var reader = new BinaryReader(pipe, Encoding.UTF8, leaveOpen: true);
        var kind = reader.ReadByte();
        var payload = WindowsSecureDesktop.ReadPayload(reader);
        var (status, response) = payload.Length > WindowsSecureDesktop.MaxPayloadBytes
            ? (ErrorInvalidParameter, [])
            : Handle(kind, payload);

        using var writer = new BinaryWriter(pipe, Encoding.UTF8, leaveOpen: true);
        writer.Write(status);
        writer.Write(response.Length);
        writer.Write(response);
    }

    private static (int Status, byte[] Response) Handle(byte kind, byte[] payload)
    {
        // Auf dem sicheren Desktop alles; auf dem normalen nur Eingaben an ein Admin-Fenster, die der
        // Server wegen UIPI nicht selbst zustellen kann.
        var desktop = FollowInputDesktop();
        var allowed = desktop switch
        {
            "Winlogon" => true,
            "Default" => kind == WindowsSecureDesktop.RequestInput
                && WindowsSecureDesktop.TargetIntegrityAbove(WindowsSecureDesktop.MediumIntegrity),
            _ => false,
        };
        if (!allowed)
        {
            return (WindowsSecureDesktop.StatusNotSecureDesktop, []);
        }

        switch (kind)
        {
            case WindowsSecureDesktop.RequestInput:
                var size = WindowsInputSender.InputSize;
                var count = payload.Length / size;
                if (count is < 1 or > MaxInputsPerRequest || payload.Length % size != 0)
                {
                    return (ErrorInvalidParameter, []);
                }

                if (SendInput((uint)count, payload, size) == count)
                {
                    return (WindowsSecureDesktop.StatusOk, []);
                }

                var error = Marshal.GetLastWin32Error();
                Log($"SendInput failed: {error}.");
                return (error, []);

            case WindowsSecureDesktop.RequestCapture:
                using (var reader = new BinaryReader(new MemoryStream(payload), Encoding.UTF8))
                {
                    var maxWidth = reader.ReadInt32();
                    var quality = reader.ReadInt32();
                    var monitor = reader.ReadString();
                    if (maxWidth is < 1 or > 8192 || quality is < 1 or > 100)
                    {
                        return (ErrorInvalidParameter, []);
                    }

                    try
                    {
                        var jpeg = WindowsScreenCapture.CaptureCurrentDesktopJpeg(maxWidth, quality, monitor.Length == 0 ? null : monitor);
                        return (WindowsSecureDesktop.StatusOk, jpeg);
                    }
                    catch (Win32Exception exception)
                    {
                        Log($"Capture failed: {exception.NativeErrorCode} {exception.Message}");
                        return (exception.NativeErrorCode, []);
                    }
                }

            default:
                return (ErrorInvalidParameter, []);
        }
    }

    // Der Thread wechselt auf den aktuellen Eingabe-Desktop ("Winlogon" oder "Default"); null, wenn
    // das nicht geht oder es ein anderer ist.
    private static string? FollowInputDesktop()
    {
        var desktop = OpenInputDesktop(0, false, DesktopGenericAll);
        if (desktop == IntPtr.Zero)
        {
            Log($"OpenInputDesktop failed: {Marshal.GetLastWin32Error()}.");
            return null;
        }

        var name = DesktopName(desktop) switch
        {
            var known when string.Equals(known, "Winlogon", StringComparison.OrdinalIgnoreCase) => "Winlogon",
            var known when string.Equals(known, "Default", StringComparison.OrdinalIgnoreCase) => "Default",
            var other => other,
        };
        if (name is not ("Winlogon" or "Default"))
        {
            Log($"Input desktop is \"{name}\", not acting.");
            CloseDesktop(desktop);
            return null;
        }

        if (!SetThreadDesktop(desktop))
        {
            Log($"SetThreadDesktop failed: {Marshal.GetLastWin32Error()}.");
            CloseDesktop(desktop);
            return null;
        }

        if (currentDesktop != IntPtr.Zero)
        {
            CloseDesktop(currentDesktop);
        }

        currentDesktop = desktop;
        return name;
    }

    internal static string DesktopName(IntPtr desktop)
    {
        var buffer = new byte[256];
        return GetUserObjectInformation(desktop, UoiName, buffer, buffer.Length, out var needed)
            ? Encoding.Unicode.GetString(buffer, 0, Math.Max(0, needed - 2))
            : string.Empty;
    }

    private const int ErrorInvalidParameter = 87;
    private const uint DesktopGenericAll = 0x10000000;
    private const int UoiName = 2;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint inputCount, byte[] inputs, int inputSize);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint desiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetThreadDesktop(IntPtr desktop);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseDesktop(IntPtr desktop);

    // Unicode: sonst bindet .NET GetUserObjectInformationA und der Name kaeme als ANSI-Bytes.
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetUserObjectInformation(IntPtr handle, int index, byte[] info, int length, out int needed);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetNamedPipeClientProcessId(Microsoft.Win32.SafeHandles.SafePipeHandle pipe, out uint clientProcessId);
}

// Der Dienst (LocalSystem, Sitzung 0) sieht selbst keinen Desktop. Er haelt nur einen Helfer in der
// aktiven Konsolen-Sitzung am Laufen: nach Start, Benutzerwechsel und falls der Helfer endet.
internal sealed class WindowsSecureDesktopService : ServiceBase
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromSeconds(2);

    private readonly string allowedSid;
    private readonly Lock gate = new();
    private System.Threading.Timer? timer;
    private Process? helper;
    private uint helperSession;

    public WindowsSecureDesktopService(string allowedSid)
    {
        this.allowedSid = allowedSid;
        ServiceName = WindowsSecureDesktop.ServiceName;
        CanHandleSessionChangeEvent = true;
    }

    protected override void OnStart(string[] args) =>
        timer = new System.Threading.Timer(_ => EnsureHelper(), null, TimeSpan.Zero, CheckInterval);

    protected override void OnSessionChange(SessionChangeDescription changeDescription) => EnsureHelper();

    protected override void OnStop()
    {
        timer?.Dispose();
        lock (gate)
        {
            StopHelper();
        }
    }

    private void EnsureHelper()
    {
        lock (gate)
        {
            var session = WTSGetActiveConsoleSessionId();
            if (session == NoSession || (helper is { HasExited: false } && helperSession == session))
            {
                return;
            }

            StopHelper();
            try
            {
                helper = StartHelper(session);
                helperSession = session;
            }
            catch (Win32Exception exception)
            {
                // Sitzung gerade im Auf- oder Abbau: beim naechsten Takt wieder.
                WindowsSecureDesktopHelper.Log($"Starting the helper in session {session} failed: {exception.NativeErrorCode}.");
            }
        }
    }

    private void StopHelper()
    {
        try
        {
            if (helper is { HasExited: false })
            {
                helper.Kill();
            }
        }
        catch (Exception exception) when (exception is InvalidOperationException or Win32Exception)
        {
        }

        helper?.Dispose();
        helper = null;
    }

    // Eigenes SYSTEM-Token mit der Sitzungsnummer der Konsole: so laeuft der Helfer als SYSTEM dort,
    // wo Sperrbildschirm und UAC-Abfrage erscheinen.
    private Process StartHelper(uint session)
    {
        if (!OpenProcessToken(Process.GetCurrentProcess().Handle, TokenAllAccess, out var ownToken))
        {
            throw new Win32Exception();
        }

        try
        {
            if (!DuplicateTokenEx(ownToken, TokenAllAccess, IntPtr.Zero, SecurityImpersonation, TokenPrimary, out var token))
            {
                throw new Win32Exception();
            }

            try
            {
                if (!SetTokenInformation(token, TokenSessionId, ref session, sizeof(uint)))
                {
                    throw new Win32Exception();
                }

                var executable = WindowsSecureDesktop.ExecutablePath;
                var commandLine = new StringBuilder($"\"{executable}\" {WindowsSecureDesktop.HelperArgument} {allowedSid} {Environment.ProcessId}");
                var startup = new StartupInfo { Size = Marshal.SizeOf<StartupInfo>(), Desktop = @"winsta0\default" };
                if (!CreateProcessAsUser(token, null, commandLine, IntPtr.Zero, IntPtr.Zero, false, CreateNoWindow, IntPtr.Zero,
                        Path.GetDirectoryName(executable), ref startup, out var info))
                {
                    throw new Win32Exception();
                }

                CloseHandle(info.Thread);
                try
                {
                    return Process.GetProcessById(info.ProcessId);
                }
                finally
                {
                    CloseHandle(info.Process);
                }
            }
            finally
            {
                CloseHandle(token);
            }
        }
        finally
        {
            CloseHandle(ownToken);
        }
    }

    private const uint NoSession = 0xFFFFFFFF;
    private const uint TokenAllAccess = 0xF01FF;
    private const int SecurityImpersonation = 2;
    private const int TokenPrimary = 1;
    private const int TokenSessionId = 12;
    private const uint CreateNoWindow = 0x08000000;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Size;
        public string? Reserved;
        public string? Desktop;
        public string? Title;
        public int X;
        public int Y;
        public int Width;
        public int Height;
        public int CountCharsX;
        public int CountCharsY;
        public int FillAttribute;
        public int Flags;
        public short ShowWindow;
        public short Reserved2Size;
        public IntPtr Reserved2;
        public IntPtr StdInput;
        public IntPtr StdOutput;
        public IntPtr StdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr Process;
        public IntPtr Thread;
        public int ProcessId;
        public int ThreadId;
    }

    [DllImport("kernel32.dll")]
    private static extern uint WTSGetActiveConsoleSessionId();

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool DuplicateTokenEx(IntPtr token, uint access, IntPtr attributes, int impersonationLevel, int tokenType, out IntPtr newToken);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetTokenInformation(IntPtr token, int informationClass, ref uint information, int length);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessAsUser(
        IntPtr token, string? applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes,
        bool inheritHandles, uint creationFlags, IntPtr environment, string? currentDirectory, ref StartupInfo startupInfo,
        out ProcessInformation processInformation);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
}
