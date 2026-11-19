using System.ComponentModel;
using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;

namespace YFRemote.Server.Services;

// Sperrbildschirm und UAC-Abfrage liegen auf dem sicheren Desktop ("Winlogon"), an den ein normaler
// Prozess weder mit SendInput noch mit BitBlt herankommt. Ein Dienst (SYSTEM) startet dafuer einen
// Helfer in der Konsolen-Sitzung (WindowsSecureDesktopHelper); der Server reicht ihm ueber eine
// Named Pipe nur das weiter, was auf dem normalen Desktop mit ERROR_ACCESS_DENIED scheitert.
// Opt-in im YFRemote-Fenster und nur fuer eine Installation unter "Program Files": ein SYSTEM-Dienst,
// dessen Datei der Benutzer selbst austauschen kann, waere eine Rechteausweitung.
public static class WindowsSecureDesktop
{
    internal const string ServiceName = "YFRemoteSecureDesktop";
    internal const string PipeName = "YFRemote.SecureDesktop";
    internal const string ServiceArgument = "--secure-desktop-service";
    internal const string HelperArgument = "--secure-desktop-helper";
    internal const string InstallArgument = "--secure-desktop-install";
    internal const string UninstallArgument = "--secure-desktop-uninstall";

    internal const byte RequestInput = 1;
    internal const byte RequestCapture = 2;
    internal const int StatusOk = 0;
    // Der Eingabe-Desktop ist gerade der normale: dort arbeitet der Server selbst.
    internal const int StatusNotSecureDesktop = -1;
    internal const int MaxPayloadBytes = 64 * 1024;

    private static readonly TimeSpan ServiceWait = TimeSpan.FromSeconds(20);

    internal static string ExecutablePath => Environment.ProcessPath ?? throw new InvalidOperationException("Unknown process path.");

    // ponytail: prueft nur den Ort, nicht die ACL des Ordners; ein von Hand beschreibbar gemachter
    // Ordner unter Program Files faellt durch.
    internal static bool IsProtectedInstallPath(string executablePath)
    {
        var fullPath = Path.GetFullPath(executablePath);
        return new[] { Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86 }
            .Select(Environment.GetFolderPath)
            .Where(folder => folder.Length > 0)
            .Any(folder => fullPath.StartsWith(Path.TrimEndingDirectorySeparator(folder) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase));
    }

    internal static bool IsAvailable => IsProtectedInstallPath(ExecutablePath);

    internal static bool IsServiceInstalled()
    {
        try
        {
            using var service = new ServiceController(ServiceName);
            _ = service.Status;
            return true;
        }
        catch (Exception exception) when (exception is Win32Exception or InvalidOperationException)
        {
            return false;
        }
    }

    // Aus dem YFRemote-Fenster: richtet den Dienst mit einer UAC-Abfrage am PC ein oder entfernt ihn.
    // false, wenn die Abfrage abgelehnt wurde oder der Schritt scheiterte.
    internal static bool ChangeServiceElevated(bool install)
    {
        var arguments = install
            ? $"{InstallArgument} {WindowsIdentity.GetCurrent().User!.Value}"
            : UninstallArgument;
        try
        {
            using var process = Process.Start(new ProcessStartInfo(ExecutablePath, arguments)
            {
                UseShellExecute = true,
                Verb = "runas",
            });
            process?.WaitForExit();
            return process?.ExitCode == 0;
        }
        catch (Win32Exception)
        {
            // 1223: die UAC-Abfrage wurde abgelehnt.
            return false;
        }
    }

    // Laeuft im erhoehten Prozess. allowedSid ist der Benutzer, dessen YFRemote den Helfer nutzen darf.
    internal static int Install(string allowedSid)
    {
        try
        {
            _ = new SecurityIdentifier(allowedSid);
        }
        catch (ArgumentException)
        {
            return 1;
        }

        if (!IsAvailable)
        {
            return 1;
        }

        if (IsServiceInstalled())
        {
            Uninstall();
        }

        var binaryPath = $"\\\"{ExecutablePath}\\\" {ServiceArgument} {allowedSid}";
        return RunServiceControl($"create {ServiceName} binPath= \"{binaryPath}\" start= auto DisplayName= \"YFRemote Sperrbildschirm und UAC\"") == 0
            && RunServiceControl($"description {ServiceName} \"Zeigt und bedient Sperrbildschirm und UAC-Abfragen fuer gekoppelte YFRemote-Geraete.\"") == 0
            && Start()
            ? 0
            : 1;
    }

    internal static int Uninstall()
    {
        Stop();
        return RunServiceControl($"delete {ServiceName}") == 0 ? 0 : 1;
    }

    // Velopack ersetzt bei einem Update den Ordner "current", aus dem Dienst und Helfer laufen.
    internal static bool Stop()
    {
        try
        {
            using var service = new ServiceController(ServiceName);
            if (service.Status != ServiceControllerStatus.Stopped)
            {
                service.Stop();
                service.WaitForStatus(ServiceControllerStatus.Stopped, ServiceWait);
            }

            return true;
        }
        catch (Exception exception) when (exception is InvalidOperationException or Win32Exception or System.ServiceProcess.TimeoutException)
        {
            return false;
        }
    }

    internal static bool Start()
    {
        try
        {
            using var service = new ServiceController(ServiceName);
            if (service.Status != ServiceControllerStatus.Running)
            {
                service.Start();
                service.WaitForStatus(ServiceControllerStatus.Running, ServiceWait);
            }

            return true;
        }
        catch (Exception exception) when (exception is InvalidOperationException or Win32Exception or System.ServiceProcess.TimeoutException)
        {
            return false;
        }
    }

    private static int RunServiceControl(string arguments)
    {
        using var process = Process.Start(new ProcessStartInfo(
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "sc.exe"),
            arguments)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
        })!;
        process.WaitForExit();
        return process.ExitCode;
    }

    // Server-Seite: null, wenn kein Helfer laeuft (Dienst nicht eingerichtet) oder er nicht hilft.
    internal static bool TrySendInput(byte[] inputs) => Request(RequestInput, inputs) is { Status: StatusOk };

    internal static byte[]? TryCaptureJpeg(int maxWidth, int quality, string? monitor)
    {
        var payload = new MemoryStream();
        using (var writer = new BinaryWriter(payload, Encoding.UTF8, leaveOpen: true))
        {
            writer.Write(maxWidth);
            writer.Write(quality);
            writer.Write(monitor ?? string.Empty);
        }

        return Request(RequestCapture, payload.ToArray()) is { Status: StatusOk, Payload.Length: > 0 } response
            ? response.Payload
            : null;
    }

    internal static (int Status, byte[] Payload)? Request(byte kind, byte[] payload)
    {
        // Ohne Helfer gibt es die Pipe nicht: WaitNamedPipe meldet das sofort, Connect wartete.
        if (!WaitNamedPipe($@"\\.\pipe\{PipeName}", 1000))
        {
            return null;
        }

        try
        {
            using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut);
            pipe.Connect(1000);
            // Tastendruecke (Passwort!) nur an den SYSTEM-Helfer: Besitzer seiner Pipe ist Administratoren
            // (Standard fuer SYSTEM), so eine Pipe kann kein normaler Benutzerprozess anlegen. Den Pfad
            // eines SYSTEM-Prozesses darf ein normaler Prozess nicht abfragen; der Vergleich mit dem
            // eigenen Pfad deckt nur den Helfer im Test ab.
            if (!IsOwnedByAdministrators(pipe)
                && !(GetNamedPipeServerProcessId(pipe.SafePipeHandle, out var serverProcessId) && IsSameExecutable(serverProcessId)))
            {
                return null;
            }

            using (var writer = new BinaryWriter(pipe, Encoding.UTF8, leaveOpen: true))
            {
                writer.Write(kind);
                writer.Write(payload.Length);
                writer.Write(payload);
            }

            using var reader = new BinaryReader(pipe, Encoding.UTF8, leaveOpen: true);
            var status = reader.ReadInt32();
            return (status, ReadPayload(reader));
        }
        catch (Exception exception) when (exception is IOException or System.TimeoutException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static bool IsOwnedByAdministrators(NamedPipeClientStream pipe) =>
        pipe.GetAccessControl().GetOwner(typeof(SecurityIdentifier)) is SecurityIdentifier owner
        && (owner.IsWellKnown(WellKnownSidType.LocalSystemSid) || owner.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid));

    internal static byte[] ReadPayload(BinaryReader reader)
    {
        var length = reader.ReadInt32();
        if (length is < 0 or > 32 * 1024 * 1024)
        {
            throw new IOException("Invalid secure desktop message length.");
        }

        var payload = reader.ReadBytes(length);
        return payload.Length == length ? payload : throw new EndOfStreamException();
    }

    // QueryLimitedInformation reicht auch fuer einen SYSTEM-Prozess; MainModule braucht mehr Rechte.
    internal static bool IsSameExecutable(uint processId)
    {
        var process = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (process == IntPtr.Zero)
        {
            return false;
        }

        try
        {
            var buffer = new StringBuilder(1024);
            var length = buffer.Capacity;
            return QueryFullProcessImageName(process, 0, buffer, ref length)
                && string.Equals(buffer.ToString(), ExecutablePath, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            CloseHandle(process);
        }
    }

    private const uint ProcessQueryLimitedInformation = 0x1000;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref int size);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool WaitNamedPipe(string name, uint timeout);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetNamedPipeServerProcessId(Microsoft.Win32.SafeHandles.SafePipeHandle pipe, out uint serverProcessId);
}
