using System.Runtime.InteropServices;
using Windows.Media.Control;
using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Lautstaerke ueber Core Audio (IAudioEndpointVolume des Standard-Wiedergabegeraets), Titel ueber
// die System-Mediensteuerung (dieselbe Quelle wie das Lautstaerke-Overlay von Windows: Spotify,
// Browser-Tabs, Filme & TV, ...). Beides wird bei jeder Abfrage neu geholt, weil sich das
// Standardgeraet und die aktive Medien-App jederzeit aendern koennen.
public sealed class WindowsMediaStatusReader
{
    private const int ERender = 0;
    private const int EConsole = 0;
    private const int ClsCtxAll = 0x17;

    private static readonly Guid AudioEndpointVolumeId = typeof(IAudioEndpointVolume).GUID;

    private GlobalSystemMediaTransportControlsSessionManager? sessionManager;

    public async Task<MediaStatusMessage> ReadAsync()
    {
        var (volume, muted) = ReadVolume();
        var (title, artist, playing) = await ReadNowPlayingAsync();
        return new MediaStatusMessage(volume, muted, title, artist, playing);
    }

    private static (int? Volume, bool Muted) ReadVolume()
    {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        IMMDevice? device = null;
        object? endpoint = null;

        try
        {
            // Kein Wiedergabegeraet (z.B. Kopfhoerer abgezogen, keins mehr uebrig): kein Fehler.
            if (enumerator.GetDefaultAudioEndpoint(ERender, EConsole, out device) != 0)
            {
                return (null, false);
            }

            var iid = AudioEndpointVolumeId;
            Marshal.ThrowExceptionForHR(device.Activate(ref iid, ClsCtxAll, IntPtr.Zero, out endpoint));
            var volume = (IAudioEndpointVolume)endpoint;
            Marshal.ThrowExceptionForHR(volume.GetMasterVolumeLevelScalar(out var level));
            Marshal.ThrowExceptionForHR(volume.GetMute(out var muted));
            return ((int)Math.Round(level * 100), muted);
        }
        finally
        {
            Release(endpoint);
            Release(device);
            Release(enumerator);
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
    }

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
