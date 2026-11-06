using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading.Channels;
using SharpGen.Runtime;
using Vortice;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.MediaFoundation;

namespace YFRemote.Server.Services;

// H.264 statt JPEG: Aufnahme, Mauszeiger, Umrechnung nach NV12 samt Verkleinern und Kodieren
// laufen auf der Grafikkarte (Hardware-Encoder ueber Media Foundation), der Prozessor sortiert nur
// noch Bytes. Ein Video braucht fuer dieselbe Bildqualitaet einen Bruchteil der JPEG-Bandbreite,
// weil es nur die Aenderungen zum vorigen Bild schickt.
public sealed partial class WindowsScreenCapture
{
    // Feste Zeitachse von 60 Bildern/s, siehe Fmp4Writer.
    private const int VideoTimescale = 60000;
    private const int VideoFrameDuration = 1000;
    private const long FrameTicks = TimeSpan.TicksPerSecond / 60;
    // Ein Schluesselbild alle 2 s Videozeit: der Browser kann alten Puffer nur bis zu einem
    // Schluesselbild verwerfen.
    private const uint GopFrames = 120;
    private const uint UnconstrainedVbr = 2;
    // Auch ohne Aenderung ein Bild pro Sekunde, damit der Browser die Verbindung nicht fuer tot haelt.
    private static readonly TimeSpan KeepAlive = TimeSpan.FromSeconds(1);
    private static readonly Guid LowLatencyMode = new("9c27891a-ed7a-40e1-88e8-b22727a024ee");
    private static readonly Guid GopSize = new("95f31b26-95a4-41aa-9303-246a7fc6eef1");
    private static readonly Guid MeanBitRate = new("f7222374-2144-4815-b550-a37f8e12ee52");
    private static readonly Guid RateControlMode = new("1c0608e9-370c-4710-8a58-cb6181c42423");
    private static readonly Guid EnumAdapterLuid = new("1d39518c-e220-4da8-a07f-ba172552d6b1");
    private static readonly Guid H264 = VideoFormatGuids.FromFourCC(new FourCC("H264"));
    private static readonly Guid Nv12 = VideoFormatGuids.FromFourCC(new FourCC("NV12"));
    private static readonly Lazy<bool> MediaFoundationStarted = new(() =>
    {
        MediaFactory.MFStartup(false).CheckError();
        return true;
    });

    public async Task StreamVideoAsync(
        int maxWidth,
        int bitrateKbps,
        string? monitor,
        Action<string> onStart,
        Func<byte[], Task> onFragment,
        CancellationToken cancellationToken)
    {
        // Rueckstau: kommt das WLAN nicht nach, wartet die Aufnahme - die Bildrate sinkt, statt
        // dass sich Bilder stauen. Das Warten beim Senden senkt zugleich die Bitrate.
        var fragments = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(3) { SingleReader = true, SingleWriter = true });
        var started = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var bitrate = new VideoBitrateControl(bitrateKbps);
        var producer = Task.Factory.StartNew(
            () =>
            {
                try
                {
                    ProduceVideo(maxWidth, bitrate, monitor, started, fragments.Writer, stop.Token);
                    fragments.Writer.TryComplete();
                }
                catch (Exception exception)
                {
                    started.TrySetException(exception);
                    fragments.Writer.TryComplete(exception);
                }
            },
            CancellationToken.None,
            TaskCreationOptions.LongRunning,
            TaskScheduler.Default);

        try
        {
            onStart(await started.Task.WaitAsync(cancellationToken));
            var clock = Stopwatch.StartNew();
            await foreach (var fragment in fragments.Reader.ReadAllAsync(cancellationToken))
            {
                var before = clock.Elapsed;
                await onFragment(fragment);
                bitrate.Report(fragment.Length, clock.Elapsed - before, clock.Elapsed);
            }
        }
        finally
        {
            stop.Cancel();
            await producer;
        }
    }

    private void ProduceVideo(
        int maxWidth,
        VideoBitrateControl bitrate,
        string? monitor,
        TaskCompletionSource<string> started,
        ChannelWriter<byte[]> fragments,
        CancellationToken cancellationToken)
    {
        _ = MediaFoundationStarted.Value;
        var screen = WindowsMonitors.Find(monitor);
        var capture = CaptureFor(screen);
        var previousDpiContext = SetThreadDpiAwarenessContext(DpiAwarenessContextPerMonitorAwareV2);
        try
        {
            var encoderKbps = bitrate.Kbps;
            var start = StartPipeline(screen, capture, maxWidth, encoderKbps);
            var source = start.Source;
            using var pipeline = start.Pipeline;
            var writer = new Fmp4Writer(start.Width, start.Height, VideoTimescale, VideoFrameDuration);
            var clock = Stopwatch.StartNew();
            var lastFrame = -1L;
            var lastCursor = (X: int.MinValue, Y: int.MinValue, Handle: IntPtr.Zero);
            var lastInput = -KeepAlive;

            while (!cancellationToken.IsCancellationRequested)
            {
                using var mediaEvent = pipeline.Events.GetEvent(0);
                switch ((MediaEventTypes)mediaEvent.EventType)
                {
                    case MediaEventTypes.TransformNeedInput:
                        // Hoechstens 60 Bilder/s, auch an einem 144-Hz-Monitor.
                        var wait = lastInput + TimeSpan.FromTicks(FrameTicks) - clock.Elapsed;
                        if (wait > TimeSpan.Zero)
                        {
                            Thread.Sleep(wait);
                        }

                        while (!cancellationToken.IsCancellationRequested)
                        {
                            lock (capture.Gate)
                            {
                                if (!ReferenceEquals(capture.Duplication, source))
                                {
                                    throw new SharpGenException(Vortice.DXGI.ResultCode.AccessLost);
                                }

                                capture.LastUse = DateTime.UtcNow;
                                source.WaitForChange(50);
                                var cursor = ReadCursor(screen);
                                if (source.Frame == lastFrame && cursor == lastCursor && clock.Elapsed - lastInput < KeepAlive)
                                {
                                    continue;
                                }

                                lastFrame = source.Frame;
                                lastCursor = cursor;
                                lastInput = clock.Elapsed;
                                if (bitrate.Kbps != encoderKbps)
                                {
                                    encoderKbps = bitrate.Kbps;
                                    pipeline.SetBitrate(encoderKbps * 1000);
                                }

                                pipeline.Encode(source, screen, clock.Elapsed.Ticks);
                                break;
                            }
                        }

                        break;
                    case MediaEventTypes.TransformHaveOutput:
                        if (pipeline.ReadOutput() is { } annexB && writer.WriteFrame(annexB) is { } fragment)
                        {
                            started.TrySetResult(writer.Codec!);
                            fragments.WriteAsync(fragment, cancellationToken).AsTask().GetAwaiter().GetResult();
                        }

                        break;
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (SharpGenException exception)
        {
            // Wie beim JPEG: Zugriff verloren (sicherer Desktop, Aufloesung) - neu aufsetzen,
            // sobald wieder jemand zusieht.
            capture.Reset();
            if (started.Task.IsCompleted || exception.HResult == AccessDenied)
            {
                throw new Win32Exception(exception.HResult, "Bildschirmaufnahme unterbrochen.");
            }

            // Noch kein Bild und der Encoder will nicht: der Client bleibt bei JPEG. Bei verweigertem
            // Zugriff (oben) zeigt er dagegen den Hinweis und versucht das Video weiter.
            throw new NotSupportedException("H.264-Aufnahme nicht moeglich.", exception);
        }
        finally
        {
            SetThreadDpiAwarenessContext(previousDpiContext);
        }
    }

    private static (Duplication Source, VideoPipeline Pipeline, int Width, int Height) StartPipeline(ScreenMonitor screen, MonitorCapture capture, int maxWidth, int bitrateKbps)
    {
        Duplication source;
        lock (capture.Gate)
        {
            capture.LastUse = DateTime.UtcNow;
            capture.Duplication ??= Duplication.Create(screen.Id);
            source = capture.Duplication ?? throw new NotSupportedException("Kein Bildschirm fuer die Aufnahme.");
        }

        // Krumme Groessen laesst der Intel-Encoder erst beim ersten Bild scheitern (gemessen:
        // 710x398 und 1376x774 gehen nicht, 1360x764 und 704x396 schon). Die paar Pixel
        // Verzerrung sieht niemand.
        var width = Math.Max(16, Math.Min(maxWidth, source.Width) & ~15);
        var height = Math.Max(4, (int)((long)source.Height * width / source.Width) & ~3);
        var pipeline = VideoPipeline.Create(source, width, height, bitrateKbps * 1000)
            ?? throw new NotSupportedException("Kein Hardware-Encoder fuer H.264.");
        return (source, pipeline, width, height);
    }

    // Bild mit Zeiger -> Videoprozessor (BGRA nach NV12, verkleinert) -> Hardware-Encoder.
    private sealed class VideoPipeline : IDisposable
    {
        private const int InputTextures = 4;
        private readonly ID3D11Texture2D composed;
        private readonly IDXGISurface1 composedSurface;
        private readonly ID3D11VideoDevice videoDevice;
        private readonly ID3D11VideoContext1 videoContext;
        private readonly ID3D11VideoProcessorEnumerator processorEnumerator;
        private readonly ID3D11VideoProcessor processor;
        private readonly ID3D11VideoProcessorInputView inputView;
        private readonly ID3D11Texture2D[] nv12 = new ID3D11Texture2D[InputTextures];
        private readonly ID3D11VideoProcessorOutputView[] outputViews = new ID3D11VideoProcessorOutputView[InputTextures];
        private readonly IMFDXGIDeviceManager deviceManager;
        private readonly IMFTransform encoder;
        private readonly bool encoderProvidesSamples;
        private readonly int outputSize;
        private int next;

        private VideoPipeline(Duplication source, int width, int height, IMFDXGIDeviceManager deviceManager, IMFTransform encoder)
        {
            this.deviceManager = deviceManager;
            this.encoder = encoder;
            Events = encoder.QueryInterface<IMFMediaEventGenerator>();
            var streamInfo = encoder.GetOutputStreamInfo(0);
            encoderProvidesSamples = (streamInfo.Flags & (int)(OutputStreamInfoFlags.OutputStreamProvidesSamples | OutputStreamInfoFlags.OutputStreamCanProvideSamples)) != 0;
            outputSize = Math.Max(streamInfo.Size, width * height);

            var device = source.Device;
            composed = device.CreateTexture2D(new Texture2DDescription
            {
                Width = (uint)source.Width,
                Height = (uint)source.Height,
                MipLevels = 1,
                ArraySize = 1,
                Format = Format.B8G8R8A8_UNorm,
                SampleDescription = new SampleDescription(1, 0),
                Usage = ResourceUsage.Default,
                BindFlags = BindFlags.RenderTarget | BindFlags.ShaderResource,
                MiscFlags = ResourceOptionFlags.GdiCompatible
            });
            composedSurface = composed.QueryInterface<IDXGISurface1>();
            videoDevice = device.QueryInterface<ID3D11VideoDevice>();
            videoContext = source.Context.QueryInterface<ID3D11VideoContext1>();
            var content = new VideoProcessorContentDescription
            {
                InputFrameFormat = VideoFrameFormat.Progressive,
                InputWidth = (uint)source.Width,
                InputHeight = (uint)source.Height,
                OutputWidth = (uint)width,
                OutputHeight = (uint)height,
                InputFrameRate = new Rational(60, 1),
                OutputFrameRate = new Rational(60, 1),
                Usage = VideoUsage.PlaybackNormal
            };
            videoDevice.CreateVideoProcessorEnumerator(ref content, out processorEnumerator).CheckError();
            videoDevice.CreateVideoProcessor(processorEnumerator, 0, out processor).CheckError();
            videoContext.VideoProcessorSetStreamColorSpace1(processor, 0, ColorSpaceType.RgbFullG22NoneP709);
            videoContext.VideoProcessorSetOutputColorSpace1(processor, ColorSpaceType.YcbcrStudioG22LeftP709);
            videoContext.VideoProcessorSetStreamAutoProcessingMode(processor, 0, false);
            videoDevice.CreateVideoProcessorInputView(
                composed,
                processorEnumerator,
                new VideoProcessorInputViewDescription { ViewDimension = VideoProcessorInputViewDimension.Texture2D },
                out inputView).CheckError();
            for (var index = 0; index < InputTextures; index++)
            {
                nv12[index] = device.CreateTexture2D(new Texture2DDescription
                {
                    Width = (uint)width,
                    Height = (uint)height,
                    MipLevels = 1,
                    ArraySize = 1,
                    Format = Format.NV12,
                    SampleDescription = new SampleDescription(1, 0),
                    Usage = ResourceUsage.Default,
                    BindFlags = BindFlags.RenderTarget
                });
                videoDevice.CreateVideoProcessorOutputView(
                    nv12[index],
                    processorEnumerator,
                    new VideoProcessorOutputViewDescription { ViewDimension = VideoProcessorOutputViewDimension.Texture2D },
                    out outputViews[index]).CheckError();
            }
        }

        public IMFMediaEventGenerator Events { get; }

        public static VideoPipeline? Create(Duplication source, int width, int height, int bitrate)
        {
            var encoder = ActivateEncoder(source.AdapterLuid);
            if (encoder is null)
            {
                return null;
            }

            var deviceManager = MediaFactory.MFCreateDXGIDeviceManager();
            try
            {
                deviceManager.ResetDevice(source.Device).CheckError();
                var attributes = encoder.Attributes;
                attributes.Set(TransformAttributeKeys.TransformAsyncUnlock, 1u);
                attributes.Set(LowLatencyMode, 1u);
                encoder.ProcessMessage(TMessageType.MessageSetD3DManager, (UIntPtr)(ulong)deviceManager.NativePointer);
                SetCodecValue(encoder, LowLatencyMode, 1u);
                SetCodecValue(encoder, GopSize, GopFrames);
                // Nur im VBR-Modus nimmt der Intel-Encoder eine neue Bitrate waehrend des Stroms an;
                // im Standardmodus und bei CBR meldet IsModifiable S_FALSE und nichts aendert sich.
                SetCodecValue(encoder, RateControlMode, UnconstrainedVbr);

                using (var output = MediaFactory.MFCreateMediaType())
                {
                    SetVideoType(output, H264, width, height);
                    output.Set(MediaTypeAttributeKeys.AvgBitrate, (uint)bitrate);
                    // Main-Profil ohne B-Bilder: das kann jeder Browser, und nichts wartet auf spaetere Bilder.
                    output.Set(MediaTypeAttributeKeys.Mpeg2Profile, 77u);
                    encoder.SetOutputType(0, output, 0);
                }

                using (var input = MediaFactory.MFCreateMediaType())
                {
                    SetVideoType(input, Nv12, width, height);
                    encoder.SetInputType(0, input, 0);
                }

                var pipeline = new VideoPipeline(source, width, height, deviceManager, encoder);
                encoder.ProcessMessage(TMessageType.MessageNotifyBeginStreaming, UIntPtr.Zero);
                encoder.ProcessMessage(TMessageType.MessageNotifyStartOfStream, UIntPtr.Zero);
                return pipeline;
            }
            catch
            {
                encoder.Dispose();
                deviceManager.Dispose();
                throw;
            }
        }

        public void SetBitrate(int bitrate) => SetCodecValue(encoder, MeanBitRate, (uint)bitrate);

        public void Encode(Duplication source, ScreenMonitor screen, long timestamp)
        {
            source.Context.CopyResource(composed, source.Latest);
            var hdc = composedSurface.GetDC(false);
            try
            {
                using var graphics = Graphics.FromHdc(hdc);
                DrawCursor(graphics, 1.0, screen);
            }
            finally
            {
                composedSurface.ReleaseDC(null);
            }

            var index = next++ % InputTextures;
            videoContext.VideoProcessorBlt(processor, outputViews[index], 0, 1, [new VideoProcessorStream { Enable = true, InputSurface = inputView }]).CheckError();
            using var buffer = MediaFactory.MFCreateDXGISurfaceBuffer(typeof(ID3D11Texture2D).GUID, nv12[index], 0, false);
            using var sample = MediaFactory.MFCreateSample();
            sample.AddBuffer(buffer);
            sample.SampleTime = timestamp;
            sample.SampleDuration = FrameTicks;
            encoder.ProcessInput(0, sample, 0);
        }

        public byte[]? ReadOutput()
        {
            var output = new OutputDataBuffer { StreamID = 0 };
            IMFSample? ownSample = null;
            if (!encoderProvidesSamples)
            {
                ownSample = MediaFactory.MFCreateSample();
                using var memory = MediaFactory.MFCreateMemoryBuffer(outputSize);
                ownSample.AddBuffer(memory);
                output.Sample = ownSample;
            }

            var result = encoder.ProcessOutput(ProcessOutputFlags.None, 1, ref output, out _);
            using var sample = output.Sample;
            output.Events?.Dispose();
            if (result.Code == Vortice.MediaFoundation.ResultCode.TransformStreamChange.Code)
            {
                // Manche Encoder legen ihr Ausgabeformat erst beim ersten Bild endgueltig fest.
                using var type = encoder.GetOutputAvailableType(0, 0);
                encoder.SetOutputType(0, type, 0);
                return null;
            }

            result.CheckError();
            if (sample is null)
            {
                return null;
            }

            using var contiguous = sample.ConvertToContiguousBuffer();
            contiguous.Lock(out var pointer, out _, out var length);
            try
            {
                var bytes = new byte[length];
                Marshal.Copy(pointer, bytes, 0, length);
                return bytes;
            }
            finally
            {
                contiguous.Unlock();
            }
        }

        public void Dispose()
        {
            try
            {
                encoder.ProcessMessage(TMessageType.MessageNotifyEndOfStream, UIntPtr.Zero);
                encoder.ProcessMessage(TMessageType.MessageNotifyEndStreaming, UIntPtr.Zero);
            }
            catch (SharpGenException)
            {
                // Beim Aufraeumen egal.
            }

            Events.Dispose();
            encoder.Dispose();
            deviceManager.Dispose();
            foreach (var view in outputViews)
            {
                view?.Dispose();
            }

            foreach (var texture in nv12)
            {
                texture?.Dispose();
            }

            inputView.Dispose();
            processor.Dispose();
            processorEnumerator.Dispose();
            videoContext.Dispose();
            videoDevice.Dispose();
            composedSurface.Dispose();
            composed.Dispose();
        }

        private static void SetVideoType(IMFMediaType type, Guid subtype, int width, int height)
        {
            type.Set(MediaTypeAttributeKeys.MajorType, MediaTypeGuids.Video);
            type.Set(MediaTypeAttributeKeys.Subtype, subtype);
            type.Set(MediaTypeAttributeKeys.FrameSize, ((ulong)width << 32) | (uint)height);
            type.Set(MediaTypeAttributeKeys.FrameRate, (60UL << 32) | 1);
            type.Set(MediaTypeAttributeKeys.PixelAspectRatio, (1UL << 32) | 1);
            type.Set(MediaTypeAttributeKeys.InterlaceMode, 2u);
        }

        // Der Encoder muss auf derselben Grafikkarte laufen wie die Aufnahme.
        private static IMFTransform? ActivateEncoder(long adapterLuid)
        {
            using var attributes = MediaFactory.MFCreateAttributes(1);
            attributes.Set(EnumAdapterLuid, (ulong)adapterLuid);
            MediaFactory.MFTEnum2(
                TransformCategoryGuids.VideoEncoder,
                (uint)(EnumFlag.EnumFlagHardware | EnumFlag.EnumFlagSortandfilter),
                null,
                new RegisterTypeInfo { GuidMajorType = MediaTypeGuids.Video, GuidSubtype = H264 },
                attributes,
                out var activates,
                out var count);
            try
            {
                IMFTransform? transform = null;
                for (var index = 0; index < count; index++)
                {
                    using var activate = new IMFActivate(Marshal.ReadIntPtr(activates, index * IntPtr.Size));
                    if (transform is null)
                    {
                        transform = activate.ActivateObject<IMFTransform>();
                    }
                }

                return transform;
            }
            finally
            {
                Marshal.FreeCoTaskMem(activates);
            }
        }

        private static void SetCodecValue(IMFTransform encoder, Guid api, uint value)
        {
            if (Marshal.GetObjectForIUnknown(encoder.NativePointer) is not ICodecApi codecApi)
            {
                return;
            }

            try
            {
                object boxed = value;
                codecApi.SetValue(ref api, ref boxed);
            }
            finally
            {
                Marshal.ReleaseComObject(codecApi);
            }
        }
    }

    // ICodecAPI fehlt in Vortice; nur die Methoden bis SetValue, in vtable-Reihenfolge.
    [ComImport]
    [Guid("901db4c7-31ce-41a2-85dc-8fa0bf41b8da")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ICodecApi
    {
        [PreserveSig] int IsSupported(ref Guid api);
        [PreserveSig] int IsModifiable(ref Guid api);
        [PreserveSig] int GetParameterRange(ref Guid api, IntPtr min, IntPtr max, IntPtr step);
        [PreserveSig] int GetParameterValues(ref Guid api, IntPtr values, IntPtr count);
        [PreserveSig] int GetDefaultValue(ref Guid api, IntPtr value);
        [PreserveSig] int GetValue(ref Guid api, IntPtr value);
        [PreserveSig] int SetValue(ref Guid api, [In] ref object value);
    }
}
