using System.Text.Json;
using System.Text.Json.Nodes;

namespace YFRemote.Server.Configuration;

/// <summary>
/// Einstellungen, die im Infobereich-Menue umgeschaltet werden.
/// </summary>
// Die Datei liegt bewusst neben devices.json in %LOCALAPPDATA%\YFRemote und nicht in der
// appsettings.json der Installation: Velopack ersetzt den "current"-Ordner bei jedem Update,
// ein Eintrag dort waere danach wieder weg.
internal static class UserSettingsStore
{
    private const string EnabledPropertyName = "Enabled";
    private const string NotificationsSectionName = "Notifications";

    public static string FilePath => GetFilePath(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));

    public static void SetHttpsEnabled(bool enabled) => SetHttpsEnabled(FilePath, enabled);

    public static IReadOnlySet<string> GetDisabledNotifications() => GetDisabledNotifications(FilePath);

    public static void SetNotificationEnabled(string name, bool enabled) =>
        SetNotificationEnabled(FilePath, name, enabled);

    // Gespeichert wird jede Art mit true/false; was fehlt, gilt als eingeschaltet - so zeigen neue
    // Benachrichtigungsarten nach einem Update erst einmal etwas an.
    internal static IReadOnlySet<string> GetDisabledNotifications(string filePath)
    {
        if (Read(filePath)[NotificationsSectionName] is not JsonObject section)
        {
            return new HashSet<string>();
        }

        return section
            .Where(entry => entry.Value is JsonValue value && value.TryGetValue(out bool enabled) && !enabled)
            .Select(entry => entry.Key)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    internal static void SetNotificationEnabled(string filePath, string name, bool enabled)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var root = Read(filePath);

        if (root[NotificationsSectionName] is not JsonObject section)
        {
            section = [];
            root[NotificationsSectionName] = section;
        }

        section[name] = enabled;
        Write(filePath, root);
    }

    internal static string GetFilePath(string localApplicationData)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(localApplicationData);
        return Path.Combine(localApplicationData, "YFRemote", "settings.json");
    }

    internal static void SetHttpsEnabled(string filePath, bool enabled)
    {
        var root = Read(filePath);

        if (root[HttpsOptions.SectionName] is not JsonObject httpsSection)
        {
            httpsSection = [];
            root[HttpsOptions.SectionName] = httpsSection;
        }

        httpsSection[EnabledPropertyName] = enabled;
        Write(filePath, root);
    }

    // Eine halb geschriebene Datei waere ungueltiges JSON und damit ein Startfehler, aus dem
    // heraus sich die Einstellung nicht mehr zuruecknehmen liesse - deshalb erst vollstaendig
    // daneben schreiben und dann ersetzen, wie bei devices.json.
    private static void Write(string filePath, JsonObject root)
    {
        var directoryPath = Path.GetDirectoryName(filePath);

        if (!string.IsNullOrEmpty(directoryPath))
        {
            Directory.CreateDirectory(directoryPath);
        }

        var temporaryFilePath = filePath + ".tmp";
        using (var stream = new FileStream(temporaryFilePath, FileMode.Create, FileAccess.Write))
        {
            using var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = true });
            root.WriteTo(writer);
            writer.Flush();
            stream.Flush(flushToDisk: true);
        }

        File.Move(temporaryFilePath, filePath, overwrite: true);
    }

    // Andere Eintraege der Datei bleiben erhalten; eine unlesbare Datei wird ersetzt, weil sie
    // den Start ohnehin blockiert.
    private static JsonObject Read(string filePath)
    {
        if (!File.Exists(filePath))
        {
            return [];
        }

        try
        {
            return JsonNode.Parse(File.ReadAllText(filePath)) as JsonObject ?? [];
        }
        catch (Exception exception) when (exception is JsonException or IOException)
        {
            return [];
        }
    }
}
