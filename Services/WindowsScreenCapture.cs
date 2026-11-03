using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using DriverType = Vortice.Direct3D.DriverType;
using FeatureLevel = Vortice.Direct3D.FeatureLevel;
using InterpolationMode = System.Drawing.Drawing2D.InterpolationMode;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace YFRemote.Server.Services;

// Bevorzugt DXGI Desktop Duplication: die Kopie kommt von der Grafikkarte und dauert wenige ms,
// BitBlt braucht fuer 1080p rund 38 ms (DWM-Rueckkopie) und schafft damit keine 30 Bilder/s.
// BitBlt bleibt der Rueckweg, wenn die Duplication nicht geht (sicherer Desktop, Remotedesktop).
public sealed class WindowsScreenCapture : IScreenCapture, IDisposable
{
    private const int SmCxScreen = 0;
    private const int SmCyScreen = 1;
    private const int CursorShowing = 1;
    // Solange sich nichts aendert, wartet ein Abruf hoechstens so lange auf ein neues Bild und
    // liefert dann das letzte noch einmal - so fragt der Client ein stehendes Bild nicht 30-mal
    // pro Sekunde ab.
    private const uint FrameWaitMs = 100;
    private static readonly TimeSpan IdleRelease = TimeSpan.FromSeconds(10);
    private static readonly IntPtr DpiAwarenessContextPerMonitorAwareV2 = -4;
    private static readonly ImageCodecInfo JpegCodec =
        ImageCodecInfo.GetImageEncoders().First(codec => codec.FormatID == ImageFormat.Jpeg.Guid);

    private readonly Lock gate = new();
    private readonly System.Threading.Timer idleTimer;
    private Duplication? duplication;
    private DateTime lastUse;
    private (long Frame, int CursorX, int CursorY, IntPtr Cursor, int MaxWidth, int Quality) cachedKey;
    private byte[]? cachedJpeg;

    public WindowsScreenCapture()
    {
        idleTimer = new System.Threading.Timer(_ => ReleaseWhenIdle(), null, IdleRelease, IdleRelease);
    }

    // Auf dem sicheren Desktop (UAC, Sperrbildschirm) schlaegt BitBlt mit Win32Exception fehl.
    public byte[] CaptureJpeg(int maxWidth, int quality)
    {
        // Physische Pixel wie in WindowsMouseService - sonst schnitte eine skalierte Anzeige ab.
        var previousDpiContext = SetThreadDpiAwarenessContext(DpiAwarenessContextPerMonitorAwareV2);
        try
        {
            return TryCaptureDuplicated(maxWidth, quality) ?? CaptureWithBitBlt(maxWidth, quality);
        }
        finally
        {
            SetThreadDpiAwarenessContext(previousDpiContext);
        }
    }

    public void Dispose()
    {
        idleTimer.Dispose();
        lock (gate)
        {
            duplication?.Dispose();
            duplication = null;
        }
    }

    private byte[]? TryCaptureDuplicated(int maxWidth, int quality)
    {
        Bitmap scaled;
        double scale;
        (long, int, int, IntPtr, int, int) key;
        // Nur Abholen und Kopieren brauchen die Duplication; das JPEG entsteht danach ausserhalb
        // der Sperre, so laufen zwei Abrufe des Clients ueberlappend.
        lock (gate)
        {
            lastUse = DateTime.UtcNow;
            try
            {
                duplication ??= Duplication.Create();
                if (duplication is null)
                {
                    return null;
                }

                duplication.WaitForChange(FrameWaitMs);
                var cursor = new CursorInfo { Size = Marshal.SizeOf<CursorInfo>() };
                var cursorVisible = GetCursorInfo(ref cursor) && cursor.Flags == CursorShowing && cursor.Cursor != IntPtr.Zero;
                key = (duplication.Frame, cursor.X, cursor.Y, cursorVisible ? cursor.Cursor : IntPtr.Zero, maxWidth, quality);
                if (cachedJpeg is not null && key == cachedKey)
                {
                    return cachedJpeg;
                }

                scaled = duplication.CopyScaled(maxWidth, out scale);
            }
            catch (SharpGen.Runtime.SharpGenException)
            {
                // Zugriff verloren (Aufloesung geaendert, sicherer Desktop, Vollbildspiel): beim
                // naechsten Abruf neu aufsetzen, diesmal per BitBlt.
                duplication?.Dispose();
                duplication = null;
                cachedJpeg = null;
                return null;
            }
        }

        using (scaled)
        {
            using (var graphics = Graphics.FromImage(scaled))
            {
                DrawCursor(graphics, scale);
            }

            var jpeg = Encode(scaled, quality);
            lock (gate)
            {
                cachedJpeg = jpeg;
                cachedKey = key;
            }

            return jpeg;
        }
    }

    private static byte[] CaptureWithBitBlt(int maxWidth, int quality)
    {
        var width = GetSystemMetrics(SmCxScreen);
        var height = GetSystemMetrics(SmCyScreen);
        using var screen = new Bitmap(width, height, PixelFormat.Format24bppRgb);
        using (var graphics = Graphics.FromImage(screen))
        {
            graphics.CopyFromScreen(0, 0, 0, 0, screen.Size, CopyPixelOperation.SourceCopy);
            DrawCursor(graphics, 1.0);
        }

        var scale = Math.Min(1.0, (double)maxWidth / width);
        using var scaled = scale < 1.0 ? Resize(screen, scale) : null;
        return Encode(scaled ?? screen, quality);
    }

    private void ReleaseWhenIdle()
    {
        // Eine offene Duplication laesst den DWM jedes Bild bereitstellen - ohne Zuschauer zuruecklegen.
        lock (gate)
        {
            if (duplication is not null && DateTime.UtcNow - lastUse > IdleRelease)
            {
                duplication.Dispose();
                duplication = null;
                cachedJpeg = null;
            }
        }
    }

    private static byte[] Encode(Bitmap bitmap, long quality)
    {
        using var stream = new MemoryStream();
        using var parameters = new EncoderParameters(1);
        parameters.Param[0] = new EncoderParameter(Encoder.Quality, quality);
        bitmap.Save(stream, JpegCodec, parameters);
        return stream.ToArray();
    }

    private static Bitmap Resize(Bitmap source, double scale)
    {
        var target = new Bitmap(
            Math.Max(1, (int)(source.Width * scale)),
            Math.Max(1, (int)(source.Height * scale)),
            PixelFormat.Format24bppRgb);
        using var graphics = Graphics.FromImage(target);
        graphics.InterpolationMode = InterpolationMode.Bilinear;
        graphics.DrawImage(source, 0, 0, target.Width, target.Height);
        return target;
    }

    // Weder BitBlt noch die Duplication nehmen den Mauszeiger mit; ohne ihn liesse sich das
    // Touchpad nach dem Bild kaum fuehren.
    private static void DrawCursor(Graphics graphics, double scale)
    {
        var info = new CursorInfo { Size = Marshal.SizeOf<CursorInfo>() };
        if (!GetCursorInfo(ref info) || info.Flags != CursorShowing || info.Cursor == IntPtr.Zero)
        {
            return;
        }

        // Der Cursor gehoert nicht diesem Prozess, Cursor(IntPtr) gibt das Handle nicht frei.
        using var cursor = new System.Windows.Forms.Cursor(info.Cursor);
        var hotSpot = cursor.HotSpot;
        cursor.Draw(graphics, new Rectangle(
            (int)((info.X - hotSpot.X) * scale),
            (int)((info.Y - hotSpot.Y) * scale),
            Math.Max(1, (int)(cursor.Size.Width * scale)),
            Math.Max(1, (int)(cursor.Size.Height * scale))));
    }

    // Desktop Duplication des Monitors, der bei (0,0) beginnt - der Hauptbildschirm, wie bei
    // screenClick. Die Staging-Textur behaelt das letzte Bild, solange sich nichts aendert.
    private sealed class Duplication : IDisposable
    {
        private readonly ID3D11Device device;
        private readonly ID3D11DeviceContext context;
        private readonly IDXGIOutputDuplication outputDuplication;
        private readonly ID3D11Texture2D staging;
        private readonly int width;
        private readonly int height;

        private Duplication(ID3D11Device device, ID3D11DeviceContext context, IDXGIOutputDuplication outputDuplication, int width, int height)
        {
            this.device = device;
            this.context = context;
            this.outputDuplication = outputDuplication;
            this.width = width;
            this.height = height;
            staging = device.CreateTexture2D(new Texture2DDescription
            {
                Width = (uint)width,
                Height = (uint)height,
                MipLevels = 1,
                ArraySize = 1,
                Format = Format.B8G8R8A8_UNorm,
                SampleDescription = new SampleDescription(1, 0),
                Usage = ResourceUsage.Staging,
                CPUAccessFlags = CpuAccessFlags.Read
            });
        }

        // Zaehlt jedes neue Bild; dient dem JPEG-Zwischenspeicher als Schluessel.
        public long Frame { get; private set; }

        private bool HasImage => Frame > 0;

        public static Duplication? Create()
        {
            using var factory = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
            for (uint adapterIndex = 0; factory.EnumAdapters1(adapterIndex, out var adapter).Success; adapterIndex++)
            {
                using (adapter)
                {
                    for (uint outputIndex = 0; adapter.EnumOutputs(outputIndex, out var output).Success; outputIndex++)
                    {
                        using (output)
                        {
                            var description = output.Description;
                            // ponytail: gedrehte Monitore (Hochformat) liefern ein gedrehtes Bild -
                            // dann lieber BitBlt; drehen, falls das jemand braucht.
                            if (description.DesktopCoordinates.Left != 0 || description.DesktopCoordinates.Top != 0
                                || description.Rotation is not (ModeRotation.Identity or ModeRotation.Unspecified))
                            {
                                continue;
                            }

                            D3D11.D3D11CreateDevice(adapter, DriverType.Unknown, DeviceCreationFlags.BgraSupport, (FeatureLevel[]?)null!, out ID3D11Device device, out ID3D11DeviceContext context).CheckError();
                            try
                            {
                                using var output1 = output.QueryInterface<IDXGIOutput1>();
                                var outputDuplication = output1.DuplicateOutput(device);
                                var mode = outputDuplication.Description.ModeDescription;
                                return new Duplication(device!, context!, outputDuplication, (int)mode.Width, (int)mode.Height);
                            }
                            catch
                            {
                                context?.Dispose();
                                device?.Dispose();
                                throw;
                            }
                        }
                    }
                }
            }

            return null;
        }

        public void WaitForChange(uint timeoutMs)
        {
            // Bis zum ersten Bild darf es laenger dauern: ohne Aenderung kaeme sonst gar keins.
            var result = outputDuplication.AcquireNextFrame(HasImage ? timeoutMs : 500, out var info, out var resource);
            if (result.Code == Vortice.DXGI.ResultCode.WaitTimeout.Code)
            {
                if (!HasImage)
                {
                    throw new SharpGen.Runtime.SharpGenException(result);
                }

                return;
            }

            result.CheckError();
            try
            {
                // Nur Mausbewegung: kein neues Bild, den Zeiger malt DrawCursor ohnehin selbst.
                if (info.LastPresentTime != 0)
                {
                    using var texture = resource!.QueryInterface<ID3D11Texture2D>();
                    context.CopyResource(staging, texture);
                    Frame++;
                }
            }
            finally
            {
                resource?.Dispose();
                outputDuplication.ReleaseFrame();
            }
        }

        public Bitmap CopyScaled(int maxWidth, out double scale)
        {
            scale = Math.Min(1.0, (double)maxWidth / width);
            var target = new Bitmap(
                Math.Max(1, (int)(width * scale)),
                Math.Max(1, (int)(height * scale)),
                PixelFormat.Format24bppRgb);
            var mapped = context.Map(staging, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None);
            try
            {
                using var source = new Bitmap(width, height, (int)mapped.RowPitch, PixelFormat.Format32bppRgb, mapped.DataPointer);
                using var graphics = Graphics.FromImage(target);
                graphics.InterpolationMode = scale < 1.0 ? InterpolationMode.Bilinear : InterpolationMode.NearestNeighbor;
                graphics.PixelOffsetMode = PixelOffsetMode.Half;
                graphics.DrawImage(source, 0, 0, target.Width, target.Height);
            }
            finally
            {
                context.Unmap(staging, 0);
            }

            return target;
        }

        public void Dispose()
        {
            staging.Dispose();
            outputDuplication.Dispose();
            context.Dispose();
            device.Dispose();
        }
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
