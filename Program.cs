using Microsoft.Extensions.Configuration.CommandLine;
using Microsoft.Extensions.Configuration.Json;
using Microsoft.Extensions.FileProviders;
using System.Net;
#if WINDOWS
using Velopack;
#endif
using YFRemote.Server.Configuration;
using YFRemote.Server.Diagnostics;
using YFRemote.Server.Endpoints;
using YFRemote.Server.Models;
using YFRemote.Server.Services;
#if WINDOWS
using YFRemote.Server.Tray;
#endif
using YFRemote.Server.WebSockets;

namespace YFRemote.Server;

internal static class Program
{
    private const string SingleInstanceMutexName = "YFRemote.Server.SingleInstance";

    // Mit diesem Argument startet YFRemote sich nach einer Einstellungsaenderung selbst neu. Der
    // Nachfolger wartet dann auf das Einzelinstanz-Mutex, statt sofort "laeuft bereits" zu melden.
    internal const string RestartWaitArgument = "--wait-for-previous-instance";

    private static readonly TimeSpan RestartWaitTimeout = TimeSpan.FromSeconds(30);

    [STAThread]
    private static void Main(string[] args)
    {
#if WINDOWS
        RunWindows(args);
#else
        RunLinux(args);
#endif
    }

#if WINDOWS
    private static void RunWindows(string[] args)
    {
        VelopackApp.Build()
            .OnBeforeUninstallFastCallback(_ =>
            {
                try
                {
                    WindowsStartupService.SetEnabled(false);
                }
                catch
                {
                    // Eine fehlgeschlagene Bereinigung darf die Deinstallation nicht blockieren.
                }
            })
            .Run();

        using var singleInstanceMutex = new Mutex(true, SingleInstanceMutexName, out var isFirstInstance);

        if (!isFirstInstance && args.Contains(RestartWaitArgument))
        {
            isFirstInstance = WaitForPreviousInstance(singleInstanceMutex);
        }

        if (!isFirstInstance)
        {
            MessageBox.Show(
                "YFRemote läuft bereits im Infobereich der Taskleiste.",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return;
        }

        ApplicationConfiguration.Initialize();

        WebApplication? app = null;

        try
        {
            app = BuildApplication([.. args.Where(argument => argument != RestartWaitArgument)]);
            app.StartAsync().GetAwaiter().GetResult();
            app.Logger.LogInformation(
                "YFRemote.Server started successfully. Diagnostics directory: {LogDirectory}",
                DiagnosticPaths.LogDirectory);

            using var trayContext = new TrayApplicationContext(app);
            Application.Run(trayContext);
        }
        catch (Exception exception)
        {
            try
            {
                app?.Logger.LogCritical(exception, "YFRemote.Server failed to start.");
            }
            catch
            {
                // Der separate Startfehler-Fallback unten muss auch bei einem Loggerfehler laufen.
            }

            WriteStartupError(exception);
            MessageBox.Show(
                $"YFRemote konnte nicht gestartet werden.\n\n{exception.Message}{DescribeUserSettingsRecovery()}",
                "YFRemote - Startfehler",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
        finally
        {
            if (app is not null)
            {
                app.Logger.LogInformation("YFRemote.Server is stopping.");
                StopAndDisposeApplication(app);
            }
        }
    }
    // Der Vorgaenger gibt das Mutex erst beim Beenden frei. Ein vom Betriebssystem freigegebenes
    // Mutex kommt als AbandonedMutexException zurueck - der Besitz geht dabei trotzdem ueber.
    private static bool WaitForPreviousInstance(Mutex singleInstanceMutex)
    {
        try
        {
            return singleInstanceMutex.WaitOne(RestartWaitTimeout);
        }
        catch (AbandonedMutexException)
        {
            return true;
        }
    }

    // Eine im Infobereich umgeschaltete Einstellung kann den Start verhindern (zum Beispiel HTTPS
    // mit beschaedigter CA-Datei). Dann kommt man ohne diesen Hinweis nicht mehr an den Schalter.
    private static string DescribeUserSettingsRecovery()
    {
        var filePath = UserSettingsStore.FilePath;

        return File.Exists(filePath)
            ? $"\n\nFalls es an einer Einstellung aus dem Infobereich-Menü liegt: Lösche\n{filePath}\nund starte YFRemote erneut."
            : string.Empty;
    }
#else
    // Kein Tray, kein Velopack-Lifecycle, kein Mutex: ein fehlgeschlagenes Port-Binding sagt
    // bereits "es laeuft schon eine Instanz", ganz ohne separate Einzelinstanz-Pruefung.
    private static void RunLinux(string[] args)
    {
        if (args.Contains("--uinput-smoke-test"))
        {
            RunUinputSmokeTest();
            return;
        }

        WebApplication? app = null;

        try
        {
            app = BuildApplication(args);
            app.Logger.LogInformation(
                "YFRemote.Server started successfully. Diagnostics directory: {LogDirectory}",
                DiagnosticPaths.LogDirectory);

            // Kein Tray auf Linux, also kein Menue-Eintrag fuer die PIN: sie muss stattdessen
            // hier auf der Konsole des Servers erscheinen, sonst kann sich kein Geraet koppeln.
            var (pin, expiresAtUtc) = app.Services.GetRequiredService<PairingService>().GetCurrentPin();
            Console.WriteLine($"Pairing-PIN: {pin} (gueltig bis {expiresAtUtc:HH:mm:ss} UTC)");

            app.Run();
        }
        catch (Exception exception)
        {
            try
            {
                app?.Logger.LogCritical(exception, "YFRemote.Server failed to start.");
            }
            catch
            {
                // Der separate Startfehler-Fallback unten muss auch bei einem Loggerfehler laufen.
            }

            WriteStartupError(exception);
            Console.Error.WriteLine(
                $"YFRemote konnte nicht gestartet werden.{Environment.NewLine}{Environment.NewLine}{exception.Message}");
        }
    }

    // Manueller Diagnosemodus fuer den Stufe-2-Beweis aus AGENTS.md "Linux support": prueft den
    // echten uinput-Sendepfad isoliert, ganz ohne Pairing/WebSocket/HTTP. Tippt in das gerade
    // fokussierte Fenster und bewegt die Maus - vorher ein harmloses Textfeld fokussieren.
    // Aufruf: dotnet run -- --uinput-smoke-test  (oder die publizierte Binary mit demselben Flag).
    private static void RunUinputSmokeTest()
    {
        Console.WriteLine("uinput-Smoketest: lege virtuelles Tastatur- und Mausgeraet an...");

        try
        {
            using var sender = new LinuxInputSender();
            var inputService = new LinuxInputService(sender);
            var mouseService = new LinuxMouseService(sender);

            Console.WriteLine("In 3 Sekunden wird 'yfremote' in das fokussierte Fenster getippt - jetzt ein Textfeld fokussieren.");
            Thread.Sleep(3000);
            inputService.TypeText("yfremote");
            Console.WriteLine("TypeText gesendet.");

            Console.WriteLine("Bewege die Maus in einem Quadrat...");
            mouseService.MoveRelative(80, 0);
            Thread.Sleep(300);
            mouseService.MoveRelative(0, 80);
            Thread.Sleep(300);
            mouseService.MoveRelative(-80, 0);
            Thread.Sleep(300);
            mouseService.MoveRelative(0, -80);
            Console.WriteLine("Mausbewegung gesendet.");

            Console.WriteLine("Linksklick...");
            mouseService.ClickLeft();

            Console.WriteLine("Scrollen...");
            mouseService.Scroll(-3);

            Console.WriteLine();
            Console.WriteLine("Fertig. Ist 'yfremote' angekommen und hat sich die Maus sichtbar bewegt: uinput funktioniert.");
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"uinput-Smoketest fehlgeschlagen: {exception}");
            Environment.Exit(1);
        }
    }
#endif

    private static void WriteStartupError(Exception exception)
    {
        try
        {
            DiagnosticPaths.EnsureLogDirectory();
            File.AppendAllText(
                DiagnosticPaths.StartupErrorLogFilePath,
                $"[{DateTimeOffset.Now:O}] {exception}{Environment.NewLine}{Environment.NewLine}");
        }
        catch
        {
            // Das Schreiben eines Diagnoseprotokolls darf den Startfehler nicht verdecken.
        }
    }

    // Reihenfolge der Quellen: Kommandozeile schlaegt die im Infobereich gespeicherte Einstellung,
    // diese wiederum Umgebungsvariablen und appsettings.json. Ein "dotnet run -- Https:Enabled=true"
    // bleibt damit auch dann wirksam, wenn der Schalter etwas anderes gespeichert hat.
    internal static void AddUserSettings(IConfigurationBuilder configuration, string filePath)
    {
        var directoryPath = Path.GetDirectoryName(filePath);

        if (!string.IsNullOrEmpty(directoryPath))
        {
            Directory.CreateDirectory(directoryPath);
        }

        var source = new JsonConfigurationSource
        {
            Path = filePath,
            Optional = true,
            ReloadOnChange = false
        };
        source.ResolveFileProvider();

        var insertIndex = configuration.Sources.Count;

        for (var index = 0; index < configuration.Sources.Count; index++)
        {
            if (configuration.Sources[index] is CommandLineConfigurationSource)
            {
                insertIndex = index;
                break;
            }
        }

        configuration.Sources.Insert(insertIndex, source);
    }

    internal static WebApplication BuildApplication(
        string[] args,
        Action<IServiceCollection>? configureServices = null)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            Args = args,
            ContentRootPath = AppContext.BaseDirectory,
            WebRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot")
        });

        AddUserSettings(builder.Configuration, UserSettingsStore.FilePath);
        DiagnosticLogging.Configure(builder);

        var serverOptions = builder.Configuration
            .GetSection(ServerOptions.SectionName)
            .Get<ServerOptions>() ?? new ServerOptions();
        serverOptions.Validate();

        var httpsOptions = builder.Configuration
            .GetSection(HttpsOptions.SectionName)
            .Get<HttpsOptions>() ?? new HttpsOptions();
        httpsOptions.Validate();

        var fileTransferOptions = builder.Configuration
            .GetSection(FileTransferOptions.SectionName)
            .Get<FileTransferOptions>() ?? new FileTransferOptions();
        fileTransferOptions.Validate();

        var clipboardOptions = builder.Configuration
            .GetSection(ClipboardOptions.SectionName)
            .Get<ClipboardOptions>() ?? new ClipboardOptions();
        clipboardOptions.Validate();

        if (httpsOptions.Enabled)
        {
            if (!IPAddress.TryParse(serverOptions.Host, out var bindAddress))
            {
                throw new InvalidOperationException(
                    "Server:Host must be an IP address (for example 0.0.0.0) when Https:Enabled is set.");
            }

            var certificateProvider = new ServerCertificateProvider(httpsOptions, TimeProvider.System);
            builder.Services.AddSingleton(certificateProvider);

            // UseUrls und eigene Kestrel-Endpunkte schliessen sich aus: sobald Listen aufgerufen
            // wird, ignoriert Kestrel UseUrls. Deshalb bindet dieser Zweig beide Ports selbst.
            builder.WebHost.ConfigureKestrel(kestrel =>
            {
                kestrel.Listen(bindAddress, serverOptions.Port);
                kestrel.Listen(bindAddress, httpsOptions.Port, listenOptions =>
                    listenOptions.UseHttps(https =>
                        https.ServerCertificateSelector = (_, _) => certificateProvider.GetServerCertificate()));
            });
        }
        else
        {
            builder.WebHost.UseUrls(serverOptions.Url);
        }

        builder.Services.AddSingleton(serverOptions);
        builder.Services.AddSingleton(httpsOptions);
        builder.Services.AddSingleton(fileTransferOptions);
        builder.Services.AddSingleton<FileTransferService>();
        builder.Services.AddSingleton(clipboardOptions);
        builder.Services.AddSingleton<ClipboardReadNotifier>();
#if WINDOWS
        builder.Services.AddSingleton<WindowsInputSender>();
        builder.Services.AddSingleton<IInputService, WindowsInputService>();
        builder.Services.AddSingleton<IMouseService, WindowsMouseService>();
        builder.Services.AddSingleton<IPowerService, WindowsPowerService>();
        builder.Services.AddSingleton<IClipboardService, WindowsClipboardService>();
#else
        builder.Services.AddSingleton<LinuxInputSender>();
        builder.Services.AddSingleton<IInputService, LinuxInputService>();
        builder.Services.AddSingleton<IMouseService, LinuxMouseService>();
        builder.Services.AddSingleton<IPowerService, LinuxPowerService>();
        builder.Services.AddSingleton<IClipboardService, LinuxClipboardService>();
#endif
        builder.Services.AddSingleton<RemoteActionHandler>();
        builder.Services.AddSingleton<YFRemoteWebSocketHandler>();
        builder.Services.AddSingleton<WebSocketConnectionRegistry>();
        builder.Services.AddSingleton(TimeProvider.System);
        var pairingStorageOptions = builder.Configuration
            .GetSection(PairingStorageOptions.SectionName)
            .Get<PairingStorageOptions>() ?? new PairingStorageOptions();
        builder.Services.AddSingleton(pairingStorageOptions);
        builder.Services.AddSingleton<PairingService>();

        configureServices?.Invoke(builder.Services);

        var app = builder.Build();

        app.UseDefaultFiles();
        app.UseStaticFiles();
        UseTestToolIfPresent(app);
        app.UseWebSockets(new WebSocketOptions
        {
            KeepAliveInterval = TimeSpan.FromSeconds(30)
        });

        app.MapGet("/health", () => new HealthResponse("ok", "YFRemote.Server", OperatingSystem.IsWindows() ? "windows" : "linux"));

        if (httpsOptions.Enabled)
        {
            // Bewusst ohne Origin- und Pairing-Pruefung und auch ueber HTTP erreichbar: das
            // Zertifikat muss installierbar sein, bevor dem Server vertraut wird. Ausgeliefert
            // wird nur der oeffentliche Teil der CA, nicht ihr Schluessel.
            app.MapGet("/ca.crt", (ServerCertificateProvider provider) => Results.File(
                provider.ExportAuthorityCertificate(),
                "application/x-x509-ca-cert",
                "YFRemote-CA.crt"));
        }

        app.MapWebSocketEndpoint();
        app.MapPairingEndpoints();
        app.MapFileEndpoints();
        app.MapClipboardEndpoints();

        var indexPath = Path.Combine(app.Environment.WebRootPath, "index.html");
        if (File.Exists(indexPath))
        {
            app.MapFallbackToFile("index.html");
        }

        app.Logger.LogInformation("YFRemote.Server starting on {Url}", serverOptions.Url);

        return app;
    }

    // Existiert nur im Repo-Checkout, nie in einer installierten Build: liefert den manuellen
    // Smoke-Test ueber eine echte HTTP-Origin aus, damit die Origin-Pruefung von /ws ihn nicht
    // ablehnt (bei file:// haette der Browser keinen passenden Origin-Header).
    private static void UseTestToolIfPresent(WebApplication app)
    {
        var testDirectory = Path.Combine(Directory.GetCurrentDirectory(), "test");
        if (!Directory.Exists(testDirectory))
        {
            return;
        }

        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = new PhysicalFileProvider(testDirectory),
            RequestPath = "/test"
        });
    }

#if WINDOWS
    private static void StopAndDisposeApplication(WebApplication app)
    {
        try
        {
            app.StopAsync(TimeSpan.FromSeconds(5)).GetAwaiter().GetResult();
        }
        finally
        {
            app.DisposeAsync().AsTask().GetAwaiter().GetResult();
        }
    }
#endif
}
