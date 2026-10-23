using System.Runtime.InteropServices;
using Windows.Media.Control;
using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Lautstaerke ueber Core Audio (IAudioEndpointVolume des Standard-Wiedergabegeraets), Titel ueber
// die System-Mediensteuerung (dieselbe Quelle wie das Lautstaerke-Overlay von Windows: Spotify,
// Browser-Tabs, Filme & TV, ...). Beides wird bei jeder Abfrage neu geholt, weil sich das
// Standardgeraet und die aktive Medien-App jederzeit aendern koennen. Bei einem Voicemeeter-Geraet
// gelten Lautstaerke und Stummschaltung dem Voicemeeter-Kanal dahinter (WindowsVoicemeeter).
public sealed class WindowsMediaStatusReader(WindowsVoicemeeter voicemeeter) : IVolumeService
{
    private const int ERender = 0;
    private const int EConsole = 0;
    private const int ClsCtxAll = 0x17;
    private const int StgmRead = 0;
    private const ushort VtLpwstr = 31;

    private static readonly Guid AudioEndpointVolumeId = typeof(IAudioEndpointVolume).GUID;

    // PKEY_DeviceInterface_FriendlyName: der Adaptername ("VB-Audio Voicemeeter VAIO"), den
    // Nutzer anders als den Geraetenamen nicht umbenennen koennen.
    private static readonly PropertyKey DeviceInterfaceFriendlyName =
        new(new Guid("026E516E-B814-414B-83CD-856D6FEF4822"), 2);

    private GlobalSystemMediaTransportControlsSessionManager? sessionManager;

    public async Task<MediaStatusMessage> ReadAsync()
    {
        var (volume, muted) = ReadVolume();
        var (title, artist, playing) = await ReadNowPlayingAsync();
        return new MediaStatusMessage(volume, muted, title, artist, playing);
    }

    // Wie der Lautstaerkeregler von Windows: wer die Lautstaerke zieht, will auch etwas hoeren.
    public void SetVolume(int percent)
    {
        var applied = WithEndpointVolume((volume, deviceName) =>
        {
            if (voicemeeter.ChannelFor(deviceName) is { } channel)
            {
                voicemeeter.SetParameter($"{channel}.Gain", WindowsVoicemeeter.PercentToGain(percent));
                voicemeeter.SetParameter($"{channel}.Mute", 0f);
                return true;
            }

            var context = Guid.Empty;
            Marshal.ThrowExceptionForHR(volume.SetMasterVolumeLevelScalar(percent / 100f, ref context));
            Marshal.ThrowExceptionForHR(volume.SetMute(false, ref context));
            return true;
        });

        if (!applied)
        {
            throw new InvalidOperationException("No playback device.");
        }
    }

    // Wie die Lautstaerketasten von Windows: 2 % pro Druck, Lauter/Leiser hebt die Stummschaltung auf.
    public bool TryHandleVolumeKey(string key) =>
        WithEndpointVolume((_, deviceName) =>
        {
            if (voicemeeter.ChannelFor(deviceName) is not { } channel)
            {
                return false;
            }

            if (key == "VOLUME_MUTE")
            {
                voicemeeter.SetParameter($"{channel}.Mute", null);
                return true;
            }

            var step = key switch { "VOLUME_UP" => 2, "VOLUME_DOWN" => -2, _ => 0 };
            if (step == 0 || voicemeeter.Get($"{channel}.Gain") is not { } gain)
            {
                return false;
            }

            voicemeeter.SetParameter(
                $"{channel}.Gain",
                WindowsVoicemeeter.PercentToGain(WindowsVoicemeeter.GainToPercent(gain) + step));
            voicemeeter.SetParameter($"{channel}.Mute", 0f);
            return true;
        });

    private (int? Volume, bool Muted) ReadVolume() =>
        WithEndpointVolume<(int?, bool)>((volume, deviceName) =>
        {
            if (voicemeeter.ChannelFor(deviceName) is { } channel
                && voicemeeter.Get($"{channel}.Gain") is { } gain
                && voicemeeter.Get($"{channel}.Mute") is { } mute)
            {
                return (WindowsVoicemeeter.GainToPercent(gain), mute >= 0.5f);
            }

            Marshal.ThrowExceptionForHR(volume.GetMasterVolumeLevelScalar(out var level));
            Marshal.ThrowExceptionForHR(volume.GetMute(out var muted));
            return ((int)Math.Round(level * 100), muted);
        });

    // Liefert default, wenn es kein Wiedergabegeraet gibt (z.B. Kopfhoerer abgezogen, keins mehr
    // uebrig) - das ist kein Fehler.
    private static T? WithEndpointVolume<T>(Func<IAudioEndpointVolume, string?, T> use)
    {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        IMMDevice? device = null;
        object? endpoint = null;

        try
        {
            if (enumerator.GetDefaultAudioEndpoint(ERender, EConsole, out device) != 0)
            {
                return default;
            }

            var iid = AudioEndpointVolumeId;
            Marshal.ThrowExceptionForHR(device.Activate(ref iid, ClsCtxAll, IntPtr.Zero, out endpoint));
            return use((IAudioEndpointVolume)endpoint, ReadInterfaceName(device));
        }
        finally
        {
            Release(endpoint);
            Release(device);
            Release(enumerator);
        }
    }

    private static string? ReadInterfaceName(IMMDevice device)
    {
        if (device.OpenPropertyStore(StgmRead, out var properties) != 0)
        {
            return null;
        }

        try
        {
            var key = DeviceInterfaceFriendlyName;
            if (properties.GetValue(ref key, out var value) != 0)
            {
                return null;
            }

            try
            {
                return value.Type == VtLpwstr ? Marshal.PtrToStringUni(value.Pointer) : null;
            }
            finally
            {
                PropVariantClear(ref value);
            }
        }
        finally
        {
            Release(properties);
        }
    }

    private async Task<(string? Title, string? Artist, bool Playing)> ReadNowPlayingAsync()
    {
        sessionManager ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        var session = sessionManager.GetCurrentSession();
        if (session is null)
        {
            return (null, null, false);
        }

        var properties = await session.TryGetMediaPropertiesAsync();
        var playing = session.GetPlaybackInfo()?.PlaybackStatus
            == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
        return (NullIfEmpty(properties?.Title), NullIfEmpty(properties?.Artist), playing);
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;

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

        [PreserveSig]
        int OpenPropertyStore(int stgmAccess, out IPropertyStore properties);
    }

    [ComImport]
    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        [PreserveSig]
        int GetCount(out uint count);

        [PreserveSig]
        int GetAt(uint index, out PropertyKey key);

        [PreserveSig]
        int GetValue(ref PropertyKey key, out PropVariant value);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey(Guid formatId, int propertyId)
    {
        public Guid FormatId = formatId;
        public int PropertyId = propertyId;
    }

    // Nur der Zeiger-Teil der Union wird gebraucht; Padding haelt die Groesse bei 16/24 Byte.
    [StructLayout(LayoutKind.Sequential)]
    private struct PropVariant
    {
        public ushort Type;
        public ushort Reserved1;
        public ushort Reserved2;
        public ushort Reserved3;
        public IntPtr Pointer;
        public IntPtr Padding;
    }

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PropVariant value);

    // Nur die Reihenfolge der vtable zaehlt: die ungenutzten Methoden davor muessen deklariert sein.
    [ComImport]
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume
    {
        [PreserveSig]
        int RegisterControlChangeNotify(IntPtr notify);

        [PreserveSig]
        int UnregisterControlChangeNotify(IntPtr notify);

        [PreserveSig]
        int GetChannelCount(out uint channelCount);

        [PreserveSig]
        int SetMasterVolumeLevel(float levelDb, ref Guid eventContext);

        [PreserveSig]
        int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);

        [PreserveSig]
        int GetMasterVolumeLevel(out float levelDb);

        [PreserveSig]
        int GetMasterVolumeLevelScalar(out float level);

        [PreserveSig]
        int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid eventContext);

        [PreserveSig]
        int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);

        [PreserveSig]
        int GetChannelVolumeLevel(uint channel, out float levelDb);

        [PreserveSig]
        int GetChannelVolumeLevelScalar(uint channel, out float level);

        [PreserveSig]
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);

        [PreserveSig]
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }
}
