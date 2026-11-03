using System.Buffers;
using System.Buffers.Binary;
using System.Runtime.InteropServices;

namespace YFRemote.Server.Services;

// WASAPI-Loopback des Standard-Wiedergabegeraets: dasselbe, was aus den Lautsprechern kommt.
public sealed class WindowsAudioCapture : IAudioCapture
{
    private const int ERender = 0;
    private const int EConsole = 0;
    private const int ClsCtxAll = 0x17;
    private const int SharedMode = 0;
    private const int StreamFlagsLoopback = 0x00020000;
    private const int BufferFlagsSilent = 0x2;
    private const short FormatPcm = 1;
    private const short FormatFloat = 3;
    private const short FormatExtensible = unchecked((short)0xFFFE);
    // 500 ms Puffer in 100-ns-Einheiten; abgeholt wird alle 20 ms, Task.Delay darf also ruhig
    // auf die 15,6-ms-Timeraufloesung von Windows aufrunden.
    private const long BufferDuration = 5_000_000;
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(20);
    private static readonly Guid FloatSubFormat = new("00000003-0000-0010-8000-00aa00389b71");

    public async Task CaptureAsync(
        Action<int, int> started,
        Func<ReadOnlyMemory<byte>, Task> write,
        CancellationToken cancellationToken)
    {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        IMMDevice? device = null;
        object? clientObject = null;
        object? captureObject = null;
        var format = IntPtr.Zero;

        try
        {
            Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(ERender, EConsole, out device));
            var iid = typeof(IAudioClient).GUID;
            Marshal.ThrowExceptionForHR(device.Activate(ref iid, ClsCtxAll, IntPtr.Zero, out clientObject));
            var client = (IAudioClient)clientObject;
            Marshal.ThrowExceptionForHR(client.GetMixFormat(out format));

            var channels = Marshal.ReadInt16(format, 2);
            var sampleRate = Marshal.ReadInt32(format, 4);
            var bitsPerSample = Marshal.ReadInt16(format, 14);
            var formatTag = Marshal.ReadInt16(format, 0);
            var isFloat = formatTag == FormatFloat
                || (formatTag == FormatExtensible && Marshal.PtrToStructure<Guid>(format + 24) == FloatSubFormat);
            if (!(isFloat && bitsPerSample == 32) && !(formatTag is FormatPcm or FormatExtensible && !isFloat && bitsPerSample == 16))
            {
                throw new NotSupportedException($"Mischformat mit {bitsPerSample} Bit wird nicht unterstuetzt.");
            }

            Marshal.ThrowExceptionForHR(client.Initialize(SharedMode, StreamFlagsLoopback, BufferDuration, 0, format, IntPtr.Zero));
            iid = typeof(IAudioCaptureClient).GUID;
            Marshal.ThrowExceptionForHR(client.GetService(ref iid, out captureObject));
            var capture = (IAudioCaptureClient)captureObject;

            // ponytail: bei 5.1/7.1 nur die ersten beiden Kanaele (vorne links/rechts) - Center und
            // Surround fehlen dann. Richtiger Downmix ueber dwChannelMask, falls das jemand braucht.
            var outputChannels = Math.Min((int)channels, 2);
            started(sampleRate, outputChannels);
            Marshal.ThrowExceptionForHR(client.Start());

            var output = new ArrayBufferWriter<byte>();
            var floats = Array.Empty<float>();
            var shorts = Array.Empty<short>();
            try
            {
                while (true)
                {
                    await Task.Delay(PollInterval, cancellationToken);
                    output.ResetWrittenCount();

                    while (true)
                    {
                        Marshal.ThrowExceptionForHR(capture.GetNextPacketSize(out var packetFrames));
                        if (packetFrames == 0)
                        {
                            break;
                        }

                        Marshal.ThrowExceptionForHR(capture.GetBuffer(out var data, out var frames, out var flags, out _, out _));
                        var samples = (int)frames * channels;
                        var target = output.GetSpan((int)frames * outputChannels * 2)[..((int)frames * outputChannels * 2)];
                        if ((flags & BufferFlagsSilent) != 0)
                        {
                            target.Clear();
                        }
                        else if (isFloat)
                        {
                            if (floats.Length < samples)
                            {
                                floats = new float[samples];
                            }

                            Marshal.Copy(data, floats, 0, samples);
                            for (var frame = 0; frame < frames; frame++)
                            {
                                for (var channel = 0; channel < outputChannels; channel++)
                                {
                                    var sample = Math.Clamp(floats[frame * channels + channel], -1f, 1f);
                                    BinaryPrimitives.WriteInt16LittleEndian(
                                        target[(2 * ((frame * outputChannels) + channel))..],
                                        (short)(sample * short.MaxValue));
                                }
                            }
                        }
                        else
                        {
                            if (shorts.Length < samples)
                            {
                                shorts = new short[samples];
                            }

                            Marshal.Copy(data, shorts, 0, samples);
                            for (var frame = 0; frame < frames; frame++)
                            {
                                for (var channel = 0; channel < outputChannels; channel++)
                                {
                                    BinaryPrimitives.WriteInt16LittleEndian(
                                        target[(2 * ((frame * outputChannels) + channel))..],
                                        shorts[frame * channels + channel]);
                                }
                            }
                        }

                        output.Advance(target.Length);
                        Marshal.ThrowExceptionForHR(capture.ReleaseBuffer(frames));
                    }

                    // Bei Stille liefert Loopback gar keine Pakete - dann geht auch nichts raus.
                    if (output.WrittenCount > 0)
                    {
                        await write(output.WrittenMemory);
                    }
                }
            }
            finally
            {
                client.Stop();
            }
        }
        finally
        {
            if (format != IntPtr.Zero)
            {
                Marshal.FreeCoTaskMem(format);
            }

            Release(captureObject);
            Release(clientObject);
            Release(device);
            Release(enumerator);
        }
    }

    private static void Release(object? comObject)
    {
        if (comObject is not null && Marshal.IsComObject(comObject))
        {
            Marshal.ReleaseComObject(comObject);
        }
    }

    [ComImport]
    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumerator;

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig]
        int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);

        [PreserveSig]
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig]
        int Activate(
            ref Guid iid,
            int clsCtx,
            IntPtr activationParams,
            [MarshalAs(UnmanagedType.IUnknown)] out object endpoint);
    }

    // Reihenfolge = vtable-Reihenfolge, auch fuer die hier ungenutzten Methoden.
    [ComImport]
    [Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioClient
    {
        [PreserveSig]
        int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);

        [PreserveSig]
        int GetBufferSize(out uint frames);

        [PreserveSig]
        int GetStreamLatency(out long latency);

        [PreserveSig]
        int GetCurrentPadding(out uint frames);

        [PreserveSig]
        int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);

        [PreserveSig]
        int GetMixFormat(out IntPtr format);

        [PreserveSig]
        int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);

        [PreserveSig]
        int Start();

        [PreserveSig]
        int Stop();

        [PreserveSig]
        int Reset();

        [PreserveSig]
        int SetEventHandle(IntPtr eventHandle);

        [PreserveSig]
        int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport]
    [Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioCaptureClient
    {
        [PreserveSig]
        int GetBuffer(out IntPtr data, out uint frames, out int flags, out ulong devicePosition, out ulong qpcPosition);

        [PreserveSig]
        int ReleaseBuffer(uint frames);

        [PreserveSig]
        int GetNextPacketSize(out uint frames);
    }
}
