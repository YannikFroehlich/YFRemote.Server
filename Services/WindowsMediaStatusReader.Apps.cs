using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Lautstaerke pro App wie im Lautstaerkemixer von Windows: die Audio-Sitzungen des
// Standard-Wiedergabegeraets, zusammengefasst je Prozess. Wirkt auch hinter Voicemeeter, weil
// Windows die Sitzungslautstaerke einrechnet, bevor der Ton das (virtuelle) Geraet erreicht.
// ponytail: nur das Standardgeraet; Apps auf einem anderen Ausgabegeraet fehlen, bis jemand sie braucht.
public sealed partial class WindowsMediaStatusReader : IAppVolumeService
{
    private const string SystemSoundsId = "system";
    private const int SessionExpired = 2;

    // Die Dateibeschreibung zu lesen kostet je Prozess einige Millisekunden, abgefragt wird jede
    // Sekunde. ponytail: Schluessel nur die Prozessnummer - nach Wiederverwendung der Nummer
    // stimmt der Name bis zum Leeren des Caches (200 Eintraege) nicht.
    private readonly Dictionary<uint, string> processNames = [];

    public Task<AppVolumesMessage> ReadAppsAsync() =>
        Task.FromResult(new AppVolumesMessage(WithSessions(ReadApps) ?? []));

    public void SetApp(string id, int? volume, bool? muted)
    {
        var found = WithSessions(sessions =>
        {
            var matched = false;
            foreach (var session in sessions.Where(session => session.Id == id))
            {
                matched = true;
                var context = Guid.Empty;
                if (volume is { } level)
                {
                    Marshal.ThrowExceptionForHR(session.Volume.SetMasterVolume(level / 100f, ref context));
                }

                if (muted is { } mute)
                {
                    Marshal.ThrowExceptionForHR(session.Volume.SetMute(mute, ref context));
                }
            }

            return matched;
        });

        if (!found)
        {
            throw new NotSupportedException("This app no longer plays sound.");
        }
    }

    private IReadOnlyList<AppVolume> ReadApps(IReadOnlyList<AudioSession> sessions)
    {
        var apps = new Dictionary<string, AppVolume>();
        foreach (var session in sessions)
        {
            if (apps.ContainsKey(session.Id)
                || session.Control.GetState(out var state) != 0
                || state == SessionExpired)
            {
                continue;
            }

            Marshal.ThrowExceptionForHR(session.Volume.GetMasterVolume(out var level));
            Marshal.ThrowExceptionForHR(session.Volume.GetMute(out var muted));
            apps[session.Id] = new AppVolume(session.Id, AppName(session), (int)Math.Round(level * 100), muted);
        }

        return
        [
            .. apps.Values
                .OrderBy(app => app.Id == SystemSoundsId)
                .ThenBy(app => app.Name, StringComparer.CurrentCultureIgnoreCase)
        ];
    }

    private T? WithSessions<T>(Func<IReadOnlyList<AudioSession>, T> use) =>
        WithDefaultDevice<IAudioSessionManager2, T>((manager, _) =>
        {
            Marshal.ThrowExceptionForHR(manager.GetSessionEnumerator(out var enumerator));
            var sessions = new List<AudioSession>();
            try
            {
                Marshal.ThrowExceptionForHR(enumerator.GetCount(out var count));
                for (var index = 0; index < count; index++)
                {
                    if (enumerator.GetSession(index, out var control) != 0)
                    {
                        continue;
                    }

                    var id = control.IsSystemSoundsSession() == 0
                        ? SystemSoundsId
                        : control.GetProcessId(out var processId) >= 0 ? processId.ToString(CultureInfo.InvariantCulture) : null;
                    if (id is null)
                    {
                        Release(control);
                        continue;
                    }

                    sessions.Add(new AudioSession(control, (ISimpleAudioVolume)control, id));
                }

                return use(sessions);
            }
            finally
            {
                foreach (var session in sessions)
                {
                    Release(session.Control);
                }

                Release(enumerator);
            }
        });

    // Den Namen setzen nur wenige Apps selbst; sonst wie im Windows-Mixer die Dateibeschreibung
    // ("Spotify", "Discord"). Der Client uebersetzt die Systemklaenge selbst.
    private string AppName(AudioSession session)
    {
        if (session.Id == SystemSoundsId)
        {
            return "System";
        }

        if (session.Control.GetDisplayName(out var displayName) == 0
            && !string.IsNullOrWhiteSpace(displayName)
            && !displayName.StartsWith('@'))
        {
            return displayName;
        }

        var processId = uint.Parse(session.Id, CultureInfo.InvariantCulture);
        lock (processNames)
        {
            if (!processNames.TryGetValue(processId, out var name))
            {
                if (processNames.Count >= 200)
                {
                    processNames.Clear();
                }

                name = processNames[processId] = ProcessName((int)processId);
            }

            return name;
        }
    }

    // Bei Prozessen mit hoeheren Rechten verweigert Windows die Dateibeschreibung, der Prozessname
    // geht immer.
    private static string ProcessName(int processId)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            try
            {
                if (process.MainModule?.FileVersionInfo.FileDescription is { Length: > 0 } description)
                {
                    return description.Trim();
                }
            }
            catch (Exception exception) when (exception is Win32Exception or InvalidOperationException)
            {
            }

            return process.ProcessName;
        }
        catch (ArgumentException)
        {
            return $"Prozess {processId}";
        }
    }

    private sealed record AudioSession(IAudioSessionControl2 Control, ISimpleAudioVolume Volume, string Id);

    [ComImport]
    [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionManager2
    {
        [PreserveSig]
        int GetAudioSessionControl(IntPtr sessionGuid, int streamFlags, out IntPtr sessionControl);

        [PreserveSig]
        int GetSimpleAudioVolume(IntPtr sessionGuid, int streamFlags, out IntPtr audioVolume);

        [PreserveSig]
        int GetSessionEnumerator(out IAudioSessionEnumerator enumerator);
    }

    [ComImport]
    [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionEnumerator
    {
        [PreserveSig]
        int GetCount(out int count);

        [PreserveSig]
        int GetSession(int index, out IAudioSessionControl2 session);
    }

    // Erbt von IAudioSessionControl; dessen Methoden muessen in vtable-Reihenfolge davorstehen.
    [ComImport]
    [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl2
    {
        [PreserveSig]
        int GetState(out int state);

        [PreserveSig]
        int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string displayName);

        [PreserveSig]
        int SetDisplayName(IntPtr displayName, ref Guid eventContext);

        [PreserveSig]
        int GetIconPath(out IntPtr iconPath);

        [PreserveSig]
        int SetIconPath(IntPtr iconPath, ref Guid eventContext);

        [PreserveSig]
        int GetGroupingParam(out Guid groupingParam);

        [PreserveSig]
        int SetGroupingParam(ref Guid groupingParam, ref Guid eventContext);

        [PreserveSig]
        int RegisterAudioSessionNotification(IntPtr client);

        [PreserveSig]
        int UnregisterAudioSessionNotification(IntPtr client);

        [PreserveSig]
        int GetSessionIdentifier(out IntPtr identifier);

        [PreserveSig]
        int GetSessionInstanceIdentifier(out IntPtr identifier);

        [PreserveSig]
        int GetProcessId(out uint processId);

        // S_OK (0) fuer die Systemklaenge, sonst S_FALSE.
        [PreserveSig]
        int IsSystemSoundsSession();
    }

    [ComImport]
    [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ISimpleAudioVolume
    {
        [PreserveSig]
        int SetMasterVolume(float level, ref Guid eventContext);

        [PreserveSig]
        int GetMasterVolume(out float level);

        [PreserveSig]
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);

        [PreserveSig]
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }
}
