using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class WindowsScreenCaptureTests
{
    [TestMethod]
    public void ReadCursorShape_GivesCssShapeAndKeepsCursorOutOfPicture()
    {
        var shape = WindowsScreenCapture.ReadCursorShape().Shape;

        CollectionAssert.Contains(
            new[] { "default", "text", "wait", "crosshair", "nwse-resize", "nesw-resize", "ew-resize", "ns-resize", "move", "not-allowed", "pointer", "progress", "help" },
            shape);
        Assert.AreEqual(IntPtr.Zero, WindowsScreenCapture.ReadCursor(WindowsMonitors.Find(null)).Handle);
    }
}
