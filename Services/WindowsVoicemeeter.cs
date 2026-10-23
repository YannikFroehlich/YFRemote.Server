using System.Runtime.InteropServices;
using Microsoft.Win32;
using YFRemote.Server.Configuration;
using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Voicemeeter ignoriert die Windows-Lautstaerke und -Stummschaltung seiner virtuellen
// Wiedergabegeraete. Zeigt das Standardgeraet auf Voicemeeter (oder ist Voicemeeter:Target
// gesetzt), regeln Stumm-Button, Lautstaerke und Medienleiste deshalb den Voicemeeter-Kanal ueber
// die Voicemeeter Remote API (VoicemeeterRemote64.dll aus dem Installationsordner, Fundort wie im
// Beispielcode des Voicemeeter-SDK). Dieselbe API bedient den Tab "Mixer".
public sealed class WindowsVoicemeeter(VoicemeeterOptions options) : IVoicemeeterService, IDisposable
{
    private const float MinGain = (float)IVoicemeeterService.MinGain;

    private const string UninstallKey =
        @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\VB:Voicemeeter {17359A74-1236-5467}";

    private static readonly string[] VirtualInputNames = ["Voicemeeter VAIO", "Voicemeeter AUX", "Voicemeeter VAIO3"];
    private static readonly string[] RouteCandidates = ["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3"];

    private readonly Lock gate = new();
    private readonly string libraryPath = Path.Combine(InstallDirectory(), "VoicemeeterRemote64.dll");
    private Api? api;
    private bool loaded;
    private Layout? layout;

    public bool IsInstalled => File.Exists(libraryPath);

    // Hardware-Eingaenge je Version (VBVMR_GetVoicemeeterType: 1 Voicemeeter, 2 Banana, 3 Potato);
    // danach folgen VAIO, AUX und VAIO3.
    public static int? HardwareStrips(int voicemeeterType) => voicemeeterType switch
    {
        1 => 2,
        2 => 3,
        3 => 5,
        _ => null
    };

    // Strip des Voicemeeter-Eingangs, hinter dem das Windows-Geraet steckt (Schnittstellenname wie
    // "VB-Audio Voicemeeter AUX VAIO"), oder null.
    public static int? StripFor(string deviceInterfaceName, int voicemeeterType)
    {
        if (!deviceInterfaceName.Contains("Voicemeeter", StringComparison.OrdinalIgnoreCase)
            || HardwareStrips(voicemeeterType) is not { } hardware)
        {
            return null;
        }

        var input = deviceInterfaceName.Contains("VAIO3", StringComparison.OrdinalIgnoreCase) ? 2
            : deviceInterfaceName.Contains("AUX", StringComparison.OrdinalIgnoreCase) ? 1
            : 0;
        // Voicemeeter hat einen virtuellen Eingang, Banana zwei, Potato drei.
        return input < voicemeeterType ? hardware + input : null;
    }

    // Wie der Fader in Voicemeeter: linear in dB, 0 % = -60 dB, 100 % = 0 dB. Verstaerkung ueber
    // 0 dB zeigt die Medienleiste als 100.
    public static int GainToPercent(float gain) =>
        (int)Math.Round(Math.Clamp((gain - MinGain) / -MinGain, 0f, 1f) * 100);

    public static float PercentToGain(int percent) => MinGain + Math.Clamp(percent, 0, 100) / 100f * -MinGain;

    // Kanal fuer Stumm-Button und Lautstaerke ("Strip[3]"), oder null: dann bleibt Windows zustaendig.
    public string? ChannelFor(string? deviceInterfaceName)
    {
        if (options.Target is null
            && deviceInterfaceName?.Contains("Voicemeeter", StringComparison.OrdinalIgnoreCase) != true)
        {
            return null;
        }

        lock (gate)
        {
            if (CurrentLayout() is not { } current)
            {
                return null;
            }

            if (options.Target is { } target)
            {
                return current.Has(target) ? target : null;
            }

            return StripFor(deviceInterfaceName!, current.Type) is { } strip ? $"Strip[{strip}]" : null;
        }
    }

    public float? Get(string parameter)
    {
        lock (gate)
        {
            if (CurrentLayout() is null)
            {
                return null;
            }

            // Die API liefert zwischengespeicherte Werte, erst IsParametersDirty holt neue ab.
            api!.IsParametersDirty();
            return api.GetParameterFloat(parameter, out var value) == 0 ? value : null;
        }
    }

    public Task<VoicemeeterMessage> ReadAsync()
    {
        lock (gate)
        {
            if (CurrentLayout() is not { } current)
            {
                return Task.FromResult(new VoicemeeterMessage(null, null));
            }

            api!.IsParametersDirty();
            var channels = new List<VoicemeeterChannel>(current.Strips + current.Buses);
            var hardware = HardwareStrips(current.Type)!.Value;
            for (var index = 0; index < current.Strips; index++)
            {
                channels.Add(ReadChannel(
                    $"Strip[{index}]",
                    index < hardware
                        ? $"Hardware Input {index + 1}"
                        : VirtualInputNames.ElementAtOrDefault(index - hardware) ?? $"Virtual Input {index - hardware + 1}"));
            }

            var hardwareBuses = current.Routes.Count(route => route.StartsWith('A'));
            for (var index = 0; index < current.Buses; index++)
            {
                channels.Add(ReadChannel(
                    $"Bus[{index}]",
                    index < hardwareBuses ? $"A{index + 1}" : $"B{index - hardwareBuses + 1}"));
            }

            return Task.FromResult(new VoicemeeterMessage(channels, current.Routes));
        }
    }

    public void SetParameter(string parameter, float? value)
    {
        lock (gate)
        {
            if (CurrentLayout() is not { } current)
            {
                throw new NotSupportedException("Voicemeeter is not running.");
            }

            // Das Format hat RemoteActionHandler schon geprueft ("Strip[3].A1"), hier nur, ob es den
            // Kanal und die Route in dieser Version gibt.
            var channel = parameter[..(parameter.IndexOf(']') + 1)];
            var name = parameter[(parameter.IndexOf('.') + 1)..];
            if (!current.Has(channel) || (name is not ("Mute" or "Gain") && !current.Routes.Contains(name)))
            {
                throw new NotSupportedException($"This Voicemeeter has no {parameter}.");
            }

            if (value is null)
            {
                api!.IsParametersDirty();
                if (api.GetParameterFloat(parameter, out var currentValue) != 0)
                {
                    throw new NotSupportedException($"This Voicemeeter has no {parameter}.");
                }

                value = currentValue >= 0.5f ? 0f : 1f;
            }

            api!.SetParameterFloat(parameter, value.Value);
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            api?.Logout();
            api = null;
        }
    }

    private VoicemeeterChannel ReadChannel(string id, string defaultName)
    {
        var label = api!.GetParameterString($"{id}.Label");
        api.GetParameterFloat($"{id}.Mute", out var mute);
        api.GetParameterFloat($"{id}.Gain", out var gain);
        return new VoicemeeterChannel(
            id,
            string.IsNullOrWhiteSpace(label) ? defaultName : label.Trim(),
            mute >= 0.5f,
            Math.Round(gain, 1));
    }

    // null, solange Voicemeeter nicht laeuft. Wie viele Busse und Routen eine Version hat, fragt
    // YFRemote bei Voicemeeter selbst nach (unbekannte Parameter liefern einen Fehler), statt es
    // fest einzutragen; das Ergebnis gilt bis zum naechsten Versionswechsel.
    private Layout? CurrentLayout()
    {
        if (Connect() is not { } connected
            || connected.GetVoicemeeterType(out var type) != 0
            || HardwareStrips(type) is null)
        {
            return null;
        }

        if (layout?.Type != type)
        {
            var routes = RouteCandidates
                .Where(route => connected.GetParameterFloat($"Strip[0].{route}", out _) == 0)
                .ToArray();
            layout = new Layout(type, Count(connected, "Strip"), Count(connected, "Bus"), routes);
        }

        return layout;
    }

    private static int Count(Api connected, string kind)
    {
        var count = 0;
        while (count < 8 && connected.GetParameterFloat($"{kind}[{count}].Mute", out _) == 0)
        {
            count++;
        }

        return count;
    }

    private Api? Connect()
    {
        // Ohne DLL nichts laden; wird Voicemeeter spaeter installiert, klappt es beim naechsten Aufruf.
        if (loaded || !File.Exists(libraryPath))
        {
            return api;
        }

        if (!NativeLibrary.TryLoad(libraryPath, out var library))
        {
            return null;
        }

        loaded = true;
        try
        {
            var candidate = new Api(library);
            // 1 heisst angemeldet, Voicemeeter laeuft nur noch nicht: die Verbindung steht, sobald es startet.
            api = candidate.Login() >= 0 ? candidate : null;
        }
        catch (EntryPointNotFoundException)
        {
            api = null;
        }

        return api;
    }

    private static string InstallDirectory()
    {
        using var key = Registry.LocalMachine.OpenSubKey(UninstallKey);
        return key?.GetValue("UninstallString") is string uninstaller
            && Path.GetDirectoryName(uninstaller.Trim('"')) is { Length: > 0 } directory
                ? directory
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "VB", "Voicemeeter");
    }

    private sealed record Layout(int Type, int Strips, int Buses, string[] Routes)
    {
        public bool Has(string channel) =>
            (channel.StartsWith("Strip[", StringComparison.Ordinal) && Index(channel) < Strips)
            || (channel.StartsWith("Bus[", StringComparison.Ordinal) && Index(channel) < Buses);

        private static int Index(string channel) =>
            int.TryParse(channel.AsSpan(channel.IndexOf('[') + 1, 1), out var index) ? index : int.MaxValue;
    }

    private delegate int NoArgsFunction();

    private delegate int GetTypeFunction(out int type);

    private delegate int GetFloatFunction([MarshalAs(UnmanagedType.LPStr)] string name, out float value);

    private delegate int SetFloatFunction([MarshalAs(UnmanagedType.LPStr)] string name, float value);

    [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
    private delegate int GetStringFunction([MarshalAs(UnmanagedType.LPStr)] string name, [Out] char[] value);

    private sealed class Api(IntPtr library)
    {
        // Laut SDK nimmt VBVMR_GetParameterStringW einen Puffer von 512 Zeichen.
        private const int StringLength = 512;

        public NoArgsFunction Login { get; } = Export<NoArgsFunction>(library, "VBVMR_Login");

        public NoArgsFunction Logout { get; } = Export<NoArgsFunction>(library, "VBVMR_Logout");

        public NoArgsFunction IsParametersDirty { get; } = Export<NoArgsFunction>(library, "VBVMR_IsParametersDirty");

        public GetTypeFunction GetVoicemeeterType { get; } = Export<GetTypeFunction>(library, "VBVMR_GetVoicemeeterType");

        public GetFloatFunction GetParameterFloat { get; } = Export<GetFloatFunction>(library, "VBVMR_GetParameterFloat");

        public SetFloatFunction SetParameterFloat { get; } = Export<SetFloatFunction>(library, "VBVMR_SetParameterFloat");

        private GetStringFunction GetParameterStringW { get; } = Export<GetStringFunction>(library, "VBVMR_GetParameterStringW");

        public string? GetParameterString(string name)
        {
            var buffer = new char[StringLength];
            if (GetParameterStringW(name, buffer) != 0)
            {
                return null;
            }

            var end = Array.IndexOf(buffer, '\0');
            return new string(buffer, 0, end < 0 ? buffer.Length : end);
        }

        private static T Export<T>(IntPtr library, string name)
            where T : Delegate =>
            Marshal.GetDelegateForFunctionPointer<T>(NativeLibrary.GetExport(library, name));
    }
}
