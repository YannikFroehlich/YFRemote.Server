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

    public static string FilePath => GetFilePath(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));

    public static void SetHttpsEnabled(bool enabled) => SetHttpsEnabled(FilePath, enabled);

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
