using System.Text.Json;

namespace YFRemote.Server.Configuration;

public sealed class ObsOptions
{
    public const string SectionName = "Obs";
    public const int DefaultPort = 4455;

    // Ohne Angabe gelten Port und Passwort aus der WebSocket-Einstellung von OBS selbst
    // (Werkzeuge > WebSocket-Servereinstellungen), siehe Resolve.
    public int? Port { get; init; }

    public string? Password { get; init; }

    // Konfigurationsordner von OBS Studio (%APPDATA%\obs-studio, unter Linux ~/.config/obs-studio).
    public string ConfigDirectory { get; init; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "obs-studio");

    public void Validate()
    {
        if (Port is < 1 or > 65535)
        {
            throw new InvalidOperationException("Obs:Port must be between 1 and 65535.");
        }
    }

    // Bei jedem Verbinden neu gelesen, damit ein in OBS geaendertes Passwort ohne Neustart gilt.
    // OBS 28/29 hatte das noch in global.ini; dort hilft nur Obs:Password in settings.json.
    internal ObsConnectionSettings Resolve()
    {
        var enabled = true;
        var port = DefaultPort;
        string? password = null;

        try
        {
            var file = Path.Combine(ConfigDirectory, "plugin_config", "obs-websocket", "config.json");
            using var document = JsonDocument.Parse(File.ReadAllText(file));
            var root = document.RootElement;
            enabled = !(root.TryGetProperty("server_enabled", out var enabledValue)
                && enabledValue.ValueKind == JsonValueKind.False);
            if (root.TryGetProperty("server_port", out var portValue)
                && portValue.ValueKind == JsonValueKind.Number
                && portValue.TryGetInt32(out var configuredPort)
                && configuredPort is >= 1 and <= 65535)
            {
                port = configuredPort;
            }

            if (root.TryGetProperty("auth_required", out var authValue)
                && authValue.ValueKind == JsonValueKind.True
                && root.TryGetProperty("server_password", out var passwordValue)
                && passwordValue.ValueKind == JsonValueKind.String)
            {
                password = passwordValue.GetString();
            }
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
        {
            // Keine oder unlesbare Datei: Standardport ohne Passwort versuchen.
        }

        return new ObsConnectionSettings(
            enabled || Port is not null,
            Port ?? port,
            Password ?? password);
    }
}

internal sealed record ObsConnectionSettings(bool Enabled, int Port, string? Password);
