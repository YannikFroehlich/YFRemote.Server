using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace YFRemote.Server.Services;

public sealed class WindowsScreenCapture : IScreenCapture
{
    private const int SmCxScreen = 0;
    private const int SmCyScreen = 1;
    private const int CursorShowing = 1;
    private const long JpegQuality = 70;
    private static readonly IntPtr DpiAwarenessContextPerMonitorAwareV2 = -4;
    private static readonly ImageCodecInfo JpegCodec =
        ImageCodecInfo.GetImageEncoders().First(codec => codec.FormatID == ImageFormat.Jpeg.Guid);

    // Auf dem sicheren Desktop (UAC, Sperrbildschirm) schlaegt BitBlt mit Win32Exception fehl.
    public byte[] CaptureJpeg(int maxWidth)
    {
        // Physische Pixel wie in WindowsMouseService - sonst schnitte eine skalierte Anzeige ab.
        var previousDpiContext = SetThreadDpiAwarenessContext(DpiAwarenessContextPerMonitorAwareV2);
        try
        {
            var width = GetSystemMetrics(SmCxScreen);
            var height = GetSystemMetrics(SmCyScreen);
            using var screen = new Bitmap(width, height, PixelFormat.Format24bppRgb);
            using (var graphics = Graphics.FromImage(screen))
            {
                graphics.CopyFromScreen(0, 0, 0, 0, screen.Size, CopyPixelOperation.SourceCopy);
                DrawCursor(graphics);
            }

            var scale = Math.Min(1.0, (double)maxWidth / width);
            using var scaled = scale < 1.0 ? Resize(screen, scale) : null;
            using var stream = new MemoryStream();
            using var parameters = new EncoderParameters(1);
            parameters.Param[0] = new EncoderParameter(Encoder.Quality, JpegQuality);
            (scaled ?? screen).Save(stream, JpegCodec, parameters);
            return stream.ToArray();
        }
        finally
        {
            SetThreadDpiAwarenessContext(previousDpiContext);
        }
    }

    private static Bitmap Resize(Bitmap source, double scale)
    {
        var target = new Bitmap(
            Math.Max(1, (int)(source.Width * scale)),
            Math.Max(1, (int)(source.Height * scale)),
            PixelFormat.Format24bppRgb);
        using var graphics = Graphics.FromImage(target);
        graphics.InterpolationMode = InterpolationMode.HighQualityBilinear;
        graphics.DrawImage(source, 0, 0, target.Width, target.Height);
        return target;
    }

    // BitBlt nimmt den Mauszeiger nicht mit; ohne ihn liesse sich das Touchpad nach dem Bild kaum fuehren.
    private static void DrawCursor(Graphics graphics)
    {
        var info = new CursorInfo { Size = Marshal.SizeOf<CursorInfo>() };
        if (!GetCursorInfo(ref info) || info.Flags != CursorShowing || info.Cursor == IntPtr.Zero)
        {
            return;
        }

        // Der Cursor gehoert nicht diesem Prozess, Cursor(IntPtr) gibt das Handle nicht frei.
        using var cursor = new System.Windows.Forms.Cursor(info.Cursor);
        var hotSpot = cursor.HotSpot;
        cursor.Draw(graphics, new Rectangle(info.X - hotSpot.X, info.Y - hotSpot.Y, cursor.Size.Width, cursor.Size.Height));
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct CursorInfo
    {
        public int Size;
        public int Flags;
        public IntPtr Cursor;
        public int X;
        public int Y;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetCursorInfo(ref CursorInfo info);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll")]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
}
