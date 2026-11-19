#if WINDOWS
using System.Diagnostics;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public class WindowsSecureDesktopTests
{
    [TestMethod]
    public void IsProtectedInstallPath_AcceptsOnlyProgramFiles()
    {
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        Assert.IsTrue(WindowsSecureDesktop.IsProtectedInstallPath(Path.Combine(programFiles, "YFRemote", "current", "YFRemote.Server.exe")));
        Assert.IsFalse(WindowsSecureDesktop.IsProtectedInstallPath(Path.Combine(localAppData, "YFRemote", "current", "YFRemote.Server.exe")));
        Assert.IsFalse(WindowsSecureDesktop.IsProtectedInstallPath(programFiles + "Evil" + @"\YFRemote.Server.exe"));
        Assert.IsFalse(WindowsSecureDesktop.IsProtectedInstallPath(Path.Combine(programFiles, "..", "Users", "YFRemote.Server.exe")));
    }

    // Ein Test, weil der Helfer danach bis zum Ende des Testprozesses die Pipe haelt.
    [TestMethod]
    public void Requests_FailFastWithoutHelper_AndReachTheHelperOverThePipe()
    {
        if (Directory.GetFiles(@"\\.\pipe\").Any(pipe => pipe.EndsWith(WindowsSecureDesktop.PipeName, StringComparison.OrdinalIgnoreCase)))
        {
            Assert.Inconclusive("Auf diesem Rechner ist der Dienst eingerichtet; sein Helfer haelt die Pipe.");
        }

        var stopwatch = Stopwatch.StartNew();
        Assert.IsFalse(WindowsSecureDesktop.TrySendInput(new byte[WindowsInputSender.InputSize]));
        Assert.IsNull(WindowsSecureDesktop.TryCaptureJpeg(800, 70, null));
        Assert.IsLessThan(500, stopwatch.ElapsedMilliseconds);

        // Ohne SYSTEM-Rechte ist der Eingabe-Desktop nie "Winlogon", und ein Bild gibt der Helfer nur
        // dort: er antwortet, handelt aber nicht. (Eine Eingabe gaebe er ein, waere gerade ein
        // Admin-Fenster vorne.)
        var sid = System.Security.Principal.WindowsIdentity.GetCurrent().User!.Value;
        new Thread(() => WindowsSecureDesktopHelper.Run(sid, Environment.ProcessId)) { IsBackground = true }.Start();
        (int Status, byte[] Payload)? response = null;
        for (var attempt = 0; attempt < 50 && response is null; attempt++)
        {
            Thread.Sleep(50);
            response = WindowsSecureDesktop.Request(WindowsSecureDesktop.RequestCapture, [.. BitConverter.GetBytes(800), .. BitConverter.GetBytes(70), 0]);
        }

        Assert.IsNotNull(response);
        Assert.AreEqual(WindowsSecureDesktop.StatusNotSecureDesktop, response.Value.Status);
        Assert.IsEmpty(response.Value.Payload);
    }

    [TestMethod]
    public void ProcessIntegrity_ReadsTheOwnLevel_AndNullForUnknownProcesses()
    {
        var own = WindowsSecureDesktop.ProcessIntegrity((uint)Environment.ProcessId);

        Assert.IsNotNull(own);
        Assert.AreEqual(own, WindowsSecureDesktop.OwnIntegrity);
        Assert.IsGreaterThanOrEqualTo(WindowsSecureDesktop.MediumIntegrity, own.Value);
        Assert.IsNull(WindowsSecureDesktop.ProcessIntegrity(uint.MaxValue - 3));
    }

    [TestMethod]
    public void DesktopName_ReadsTheThreadDesktopAsUnicode()
    {
        Assert.AreEqual("Default", WindowsSecureDesktopHelper.DesktopName(GetThreadDesktop(GetCurrentThreadId())));
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr GetThreadDesktop(uint threadId);

    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [TestMethod]
    public void ReadPayload_RejectsBadLengths()
    {
        using var negative = new BinaryReader(new MemoryStream(BitConverter.GetBytes(-1)));
        using var truncated = new BinaryReader(new MemoryStream([.. BitConverter.GetBytes(4), 1, 2]));

        Assert.ThrowsExactly<IOException>(() => WindowsSecureDesktop.ReadPayload(negative));
        Assert.ThrowsExactly<EndOfStreamException>(() => WindowsSecureDesktop.ReadPayload(truncated));
    }
}
#endif
