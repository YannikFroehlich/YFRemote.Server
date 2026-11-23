using System.Diagnostics;
using System.IO.Pipes;
using Microsoft.Win32;

namespace YFRemote.Server.Services;

// "An YFRemote-Geräte senden" im Rechtsklickmenue des Explorers. Der Eintrag startet YFRemote mit
// --offer-file; laeuft es schon, reicht die zweite Instanz den Pfad ueber eine Named Pipe an die
// erste weiter, statt "laeuft bereits" zu melden.
internal static class WindowsExplorerSendMenu
{
    internal const string OfferFileArgument = "--offer-file";
    private const string VerbKeyPath = @"Software\Classes\*\shell\YFRemote.SendToDevices";
    private const int MaxPathLength = 32_767;

    // Pro Windows-Sitzung eine Pipe, wie das Einzelinstanz-Mutex; CurrentUserOnly laesst nur
    // Prozesse desselben Benutzers verbinden.
    private static string DefaultPipeName => $"YFRemote.Server.OfferFile.{Process.GetCurrentProcess().SessionId}";

    // Nur fuer die installierte Version: ein Eintrag auf eine dotnet-run-Ausgabe zeigte nach dem
    // naechsten Build ins Leere. Bei jedem Start neu geschrieben, damit der Pfad stimmt.
    public static void Register()
    {
        var launcherPath = WindowsStartupService.GetLauncherPath();
        if (launcherPath is null)
        {
            return;
        }

        using var verb = Registry.CurrentUser.CreateSubKey(VerbKeyPath, writable: true);
        verb.SetValue("MUIVerb", "An YFRemote-Geräte senden");
        verb.SetValue("Icon", $"\"{launcherPath}\",0");
        using var command = verb.CreateSubKey("command", writable: true);
        command.SetValue(null, $"\"{launcherPath}\" {OfferFileArgument} \"%1\"");
    }

    public static void Unregister() =>
        Registry.CurrentUser.DeleteSubKeyTree(VerbKeyPath, throwOnMissingSubKey: false);

    public static string? GetOfferPath(string[] args)
    {
        var index = Array.IndexOf(args, OfferFileArgument);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }

    public static string[] WithoutOfferArgument(string[] args)
    {
        var index = Array.IndexOf(args, OfferFileArgument);
        return index < 0 ? args : [.. args[..index], .. args[Math.Min(index + 2, args.Length)..]];
    }

    // Statt eines Pfads: ein zweiter Start (Startmenue, Desktop) holt das Fenster der laufenden
    // Instanz nach vorn. Kein gueltiger Dateipfad, kann also nie mit einem verwechselt werden.
    public const string ShowWindowMessage = "--show";

    // pipeName nur fuer Tests: mit dem echten Namen landete der Pfad beim laufenden YFRemote.
    public static bool TrySendToRunningInstance(string path, string? pipeName = null)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", pipeName ?? DefaultPipeName, PipeDirection.Out, PipeOptions.CurrentUserOnly);
            client.Connect(TimeSpan.FromSeconds(3));
            using var writer = new StreamWriter(client);
            writer.Write(path);
            return true;
        }
        catch (Exception exception) when (exception is TimeoutException or IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    public static async Task ListenAsync(
        Action<string> onPath,
        CancellationToken cancellationToken,
        string? pipeName = null)
    {
        var buffer = new char[MaxPathLength + 1];
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await using var server = new NamedPipeServerStream(
                    pipeName ?? DefaultPipeName,
                    PipeDirection.In,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await server.WaitForConnectionAsync(cancellationToken);
                using var reader = new StreamReader(server);
                var length = await reader.ReadBlockAsync(buffer, cancellationToken);
                if (length is > 0 and <= MaxPathLength)
                {
                    onPath(new string(buffer, 0, length));
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (IOException)
            {
                // Abgebrochene Verbindung oder belegte Pipe. Ohne Pause kreist die Schleife bei einer
                // belegten Pipe ohne ein einziges await und haelt den Aufrufer fuer immer fest.
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }
    }
}
