using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

// Deckt nur die Auswahl von wl-clipboard/xclip und die Bilderkennung ab: Das eigentliche Lesen und
// Schreiben startet diese Werkzeuge und braucht eine echte grafische Sitzung - dafuer siehe
// AGENTS.md "Linux support".
[TestClass]
public sealed class LinuxClipboardServiceTests
{
    private string runtimeDirectory = null!;

    [TestInitialize]
    public void Initialize()
    {
        runtimeDirectory = Path.Combine(Path.GetTempPath(), "YFRemote.Server.Tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(runtimeDirectory);
    }

    [TestCleanup]
    public void Cleanup() => Directory.Delete(runtimeDirectory, recursive: true);

    [TestMethod]
    public void SelectBackend_PrefersWaylandDisplayFromEnvironment()
    {
        var backend = LinuxClipboardService.SelectBackend(Environment(
            ("WAYLAND_DISPLAY", "wayland-1"), ("DISPLAY", ":0")));

        Assert.AreEqual(new ClipboardBackend(ClipboardBackendKind.Wayland, "wayland-1"), backend);
    }

    [TestMethod]
    public void SelectBackend_WithoutWaylandDisplay_FindsSocketInRuntimeDirectory()
    {
        File.WriteAllText(Path.Combine(runtimeDirectory, "wayland-0.lock"), "");
        File.WriteAllText(Path.Combine(runtimeDirectory, "wayland-0"), "");

        var backend = LinuxClipboardService.SelectBackend(Environment(("XDG_RUNTIME_DIR", runtimeDirectory)));

        Assert.AreEqual(new ClipboardBackend(ClipboardBackendKind.Wayland, "wayland-0"), backend);
    }

    [TestMethod]
    public void SelectBackend_FallsBackToX11Display()
    {
        var backend = LinuxClipboardService.SelectBackend(Environment(
            ("XDG_RUNTIME_DIR", runtimeDirectory), ("DISPLAY", ":0")));

        Assert.AreEqual(new ClipboardBackend(ClipboardBackendKind.X11, ":0"), backend);
    }

    [TestMethod]
    public void SelectBackend_WithoutAnySession_ReturnsNull()
    {
        Assert.IsNull(LinuxClipboardService.SelectBackend(Environment(("XDG_RUNTIME_DIR", runtimeDirectory))));
    }

    [TestMethod]
    public void DetectImageType_RecognizesPngAndJpegOnly()
    {
        Assert.AreEqual("image/png", LinuxClipboardService.DetectImageType([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]));
        Assert.AreEqual("image/jpeg", LinuxClipboardService.DetectImageType([0xFF, 0xD8, 0xFF, 0xE0]));
        Assert.IsNull(LinuxClipboardService.DetectImageType("GIF89a"u8));
        Assert.IsNull(LinuxClipboardService.DetectImageType([]));
    }

    private static Func<string, string?> Environment(params (string Name, string Value)[] variables) =>
        name => variables.FirstOrDefault(variable => variable.Name == name).Value;
}
