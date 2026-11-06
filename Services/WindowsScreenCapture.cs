using System.Collections.Concurrent;
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
public sealed partial class WindowsScreenCapture : IScreenCapture, IDisposable
{
    private const int CursorShowing = 1;
    // DuplicateOutput meldet das bei sicherem Desktop und bei ausgeschaltetem Bildschirm. BitBlt
    // liefert dann teils ohne Fehler ein altes Bild, deshalb hier kein Rueckweg, sondern ein Hinweis.
    private const int AccessDenied = unchecked((int)0x80070005);
    // Solange sich nichts aendert, wartet ein Abruf hoechstens so lange auf ein neues Bild und
    // liefert dann das letzte noch einmal - so fragt der Client ein stehendes Bild nicht 30-mal
    // pro Sekunde ab.
    private const uint FrameWaitMs = 100;
    private static readonly TimeSpan IdleRelease = TimeSpan.FromSeconds(10);
    private static readonly IntPtr DpiAwarenessContextPerMonitorAwareV2 = -4;
    private static readonly ImageCodecInfo JpegCodec =
        ImageCodecInfo.GetImageEncoders().First(codec => codec.FormatID == ImageFormat.Jpeg.Guid);

    // Je Monitor eine eigene Sperre: das Warten auf ein neues Bild soll Zuschauer eines anderen
    // Monitors nicht aufhalten.
    private readonly ConcurrentDictionary<string, MonitorCapture> captures = new();
    private readonly System.Threading.Timer idleTimer;

    public WindowsScreenCapture()
    {
        idleTimer = new System.Threading.Timer(_ => ReleaseWhenIdle(), null, IdleRelease, IdleRelease);
    }

    public IReadOnlyList<ScreenMonitor> ListMonitors() => WindowsMonitors.List();

    // Auf dem sicheren Desktop (UAC, Sperrbildschirm) schlaegt BitBlt mit Win32Exception fehl.
    public byte[] CaptureJpeg(int maxWidth, int quality, string? monitor)
    {
        // Physische Pixel wie in WindowsMouseService - sonst schnitte eine skalierte Anzeige ab.
        var previousDpiContext = SetThreadDpiAwarenessContext(DpiAwarenessContextPerMonitorAwareV2);
        try
        {
            var screen = WindowsMonitors.Find(monitor);
            return TryCaptureDuplicated(screen, maxWidth, quality) ?? CaptureWithBitBlt(screen, maxWidth, quality);
        }
        finally
        {
            SetThreadDpiAwarenessContext(previousDpiContext);
        }
    }

    public void Dispose()
    {
        idleTimer.Dispose();
        foreach (var capture in captures.Values)
        {
            capture.Reset();
        }
    }

    private MonitorCapture CaptureFor(ScreenMonitor screen) => captures.GetOrAdd(screen.Id, _ => new MonitorCapture());

    private byte[]? TryCaptureDuplicated(ScreenMonitor screen, int maxWidth, int quality)
    {
        var capture = CaptureFor(screen);
        Bitmap scaled;
        double scale;
        (long, int, int, IntPtr, int, int) key;
        // Nur Abholen und Kopieren brauchen die Duplication; das JPEG entsteht danach ausserhalb
        // der Sperre, so laufen zwei Abrufe des Clients ueberlappend.
        lock (capture.Gate)
        {
            capture.LastUse = DateTime.UtcNow;
            try
            {
                capture.Duplication ??= Duplication.Create(screen.Id);
                if (capture.Duplication is null)
                {
                    return null;
                }

                capture.Duplication.WaitForChange(FrameWaitMs);
                var cursor = ReadCursor(screen);
                key = (capture.Duplication.Frame, cursor.X, cursor.Y, cursor.Handle, maxWidth, quality);
                if (capture.Jpeg is not null && key == capture.JpegKey)
                {
                    return capture.Jpeg;
                }

                scaled = capture.Duplication.CopyScaled(maxWidth, out scale);
            }
            catch (SharpGen.Runtime.SharpGenException exception)
            {
                // Zugriff verloren (Aufloesung geaendert, sicherer Desktop, Vollbildspiel): beim
                // naechsten Abruf neu aufsetzen, diesmal per BitBlt.
                capture.Reset();
                if (exception.HResult == AccessDenied)
                {
                    throw new System.ComponentModel.Win32Exception(exception.HResult, "Bildschirm nicht zugaenglich.");
                }

                return null;
            }
        }

        using (scaled)
        {
            using (var graphics = Graphics.FromImage(scaled))
            {
                DrawCursor(graphics, scale, screen);
            }

            var jpeg = Encode(scaled, quality);
            lock (capture.Gate)
            {
                capture.Jpeg = jpeg;
                capture.JpegKey = key;
            }

            return jpeg;
        }
    }

    private static byte[] CaptureWithBitBlt(ScreenMonitor screen, int maxWidth, int quality)
    {
        using var image = new Bitmap(screen.Width, screen.Height, PixelFormat.Format24bppRgb);
        using (var graphics = Graphics.FromImage(image))
        {
            graphics.CopyFromScreen(screen.Left, screen.Top, 0, 0, image.Size, CopyPixelOperation.SourceCopy);
            DrawCursor(graphics, 1.0, screen);
        }

        var scale = Math.Min(1.0, (double)maxWidth / screen.Width);
        using var scaled = scale < 1.0 ? Resize(image, scale) : null;
        return Encode(scaled ?? image, quality);
    }

    private void ReleaseWhenIdle()
    {
        // Eine offene Duplication laesst den DWM jedes Bild bereitstellen - ohne Zuschauer zuruecklegen.
        foreach (var capture in captures.Values)
        {
            lock (capture.Gate)
            {
                if (capture.Duplication is not null && DateTime.UtcNow - capture.LastUse > IdleRelease)
                {
                    capture.Reset();
                }
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
    private static void DrawCursor(Graphics graphics, double scale, ScreenMonitor screen)
    {
        var info = ReadCursor(screen);
        if (info.Handle == IntPtr.Zero)
        {
            return;
        }

        // Der Cursor gehoert nicht diesem Prozess, Cursor(IntPtr) gibt das Handle nicht frei.
        using var cursor = new System.Windows.Forms.Cursor(info.Handle);
        var hotSpot = cursor.HotSpot;
        cursor.Draw(graphics, new Rectangle(
            (int)((info.X - hotSpot.X) * scale),
            (int)((info.Y - hotSpot.Y) * scale),
            Math.Max(1, (int)(cursor.Size.Width * scale)),
            Math.Max(1, (int)(cursor.Size.Height * scale))));
    }

    // Position relativ zum Monitor; Zeiger auf einem anderen Monitor zaehlt als unsichtbar, damit
    // seine Bewegung hier kein neues Bild ausloest.
    private static (int X, int Y, IntPtr Handle) ReadCursor(ScreenMonitor screen)
    {
        var cursor = new CursorInfo { Size = Marshal.SizeOf<CursorInfo>() };
        return GetCursorInfo(ref cursor)
            && cursor.Flags == CursorShowing
            && cursor.Cursor != IntPtr.Zero
            && cursor.X >= screen.Left && cursor.X < screen.Left + screen.Width
            && cursor.Y >= screen.Top && cursor.Y < screen.Top + screen.Height
            ? (cursor.X - screen.Left, cursor.Y - screen.Top, cursor.Cursor)
            : (0, 0, IntPtr.Zero);
    }

    private sealed class MonitorCapture
    {
        public Lock Gate { get; } = new();

        public Duplication? Duplication { get; set; }

        public DateTime LastUse { get; set; }

        public (long Frame, int CursorX, int CursorY, IntPtr Cursor, int MaxWidth, int Quality) JpegKey { get; set; }

        public byte[]? Jpeg { get; set; }

        public void Reset()
        {
            lock (Gate)
            {
                Duplication?.Dispose();
                Duplication = null;
                Jpeg = null;
            }
        }
    }

    // Desktop Duplication eines Monitors. Die Textur Latest behaelt das letzte Bild, solange sich
    // nichts aendert.
    private sealed class Duplication : IDisposable
    {
        private readonly IDXGIOutputDuplication outputDuplication;
        private readonly ID3D11Texture2D staging;

        private Duplication(ID3D11Device device, ID3D11DeviceContext context, IDXGIOutputDuplication outputDuplication, int width, int height, long adapterLuid)
        {
            Device = device;
            Context = context;
            this.outputDuplication = outputDuplication;
            Width = width;
            Height = height;
            AdapterLuid = adapterLuid;
            var description = new Texture2DDescription
            {
                Width = (uint)width,
                Height = (uint)height,
                MipLevels = 1,
                ArraySize = 1,
                Format = Format.B8G8R8A8_UNorm,
                SampleDescription = new SampleDescription(1, 0),
                Usage = ResourceUsage.Default,
                BindFlags = BindFlags.ShaderResource
            };
            Latest = device.CreateTexture2D(description);
            staging = device.CreateTexture2D(description with
            {
                Usage = ResourceUsage.Staging,
                BindFlags = BindFlags.None,
                CPUAccessFlags = CpuAccessFlags.Read
            });
        }

        public ID3D11Device Device { get; }

        public ID3D11DeviceContext Context { get; }

        // Das letzte Bild auf der Grafikkarte, ohne Mauszeiger.
        public ID3D11Texture2D Latest { get; }

        public int Width { get; }

        public int Height { get; }

        public long AdapterLuid { get; }

        // Zaehlt jedes neue Bild; dient dem JPEG-Zwischenspeicher als Schluessel.
        public long Frame { get; private set; }

        private bool HasImage => Frame > 0;

        public static Duplication? Create(string deviceName)
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
                            if (description.DeviceName != deviceName
                                || description.Rotation is not (ModeRotation.Identity or ModeRotation.Unspecified))
                            {
                                continue;
                            }

                            // VideoSupport fuer den Videoprozessor des H.264-Streams; ohne ihn geht wenigstens JPEG.
                            if (D3D11.D3D11CreateDevice(adapter, DriverType.Unknown, DeviceCreationFlags.BgraSupport | DeviceCreationFlags.VideoSupport, (FeatureLevel[]?)null!, out ID3D11Device device, out ID3D11DeviceContext context).Failure)
                            {
                                D3D11.D3D11CreateDevice(adapter, DriverType.Unknown, DeviceCreationFlags.BgraSupport, (FeatureLevel[]?)null!, out device, out context).CheckError();
                            }

                            try
                            {
                                // Der Encoder benutzt das Geraet auch von eigenen Threads aus.
                                using (var multithread = device!.QueryInterface<ID3D11Multithread>())
                                {
                                    multithread.SetMultithreadProtected(true);
                                }

                                using var output1 = output.QueryInterface<IDXGIOutput1>();
                                var outputDuplication = output1.DuplicateOutput(device);
                                var mode = outputDuplication.Description.ModeDescription;
                                var luid = adapter.Description1.Luid;
                                return new Duplication(device, context!, outputDuplication, (int)mode.Width, (int)mode.Height, ((long)luid.HighPart << 32) | luid.LowPart);
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
                    Context.CopyResource(Latest, texture);
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
            scale = Math.Min(1.0, (double)maxWidth / Width);
            var target = new Bitmap(
                Math.Max(1, (int)(Width * scale)),
                Math.Max(1, (int)(Height * scale)),
                PixelFormat.Format24bppRgb);
            Context.CopyResource(staging, Latest);
            var mapped = Context.Map(staging, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None);
            try
            {
                using var source = new Bitmap(Width, Height, (int)mapped.RowPitch, PixelFormat.Format32bppRgb, mapped.DataPointer);
                using var graphics = Graphics.FromImage(target);
                graphics.InterpolationMode = scale < 1.0 ? InterpolationMode.Bilinear : InterpolationMode.NearestNeighbor;
                graphics.PixelOffsetMode = PixelOffsetMode.Half;
                graphics.DrawImage(source, 0, 0, target.Width, target.Height);
            }
            finally
            {
                Context.Unmap(staging, 0);
            }

            return target;
        }

        public void Dispose()
        {
            staging.Dispose();
            Latest.Dispose();
            outputDuplication.Dispose();
            Context.Dispose();
            Device.Dispose();
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
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
}
