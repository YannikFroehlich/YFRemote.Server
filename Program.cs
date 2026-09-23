using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Configuration.CommandLine;
using Microsoft.Extensions.Configuration.Json;
using Microsoft.Extensions.FileProviders;
using System.Net;
using System.Text.Json;
#if WINDOWS
using Velopack;
#endif
using YFRemote.Server.Configuration;
using YFRemote.Server.Diagnostics;
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

        app.Map("/ws", async context =>
        {
            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsync("WebSocket connection required.");
                return;
            }

            if (!IsAllowedOrigin(context.Request))
            {
                app.Logger.LogWarning(
                    "Rejected WebSocket handshake with disallowed Origin '{Origin}' from {RemoteAddress}.",
                    context.Request.Headers.Origin.ToString(),
                    context.Connection.RemoteIpAddress);
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsync("Origin not allowed.");
                return;
            }

            var pairingService = context.RequestServices.GetRequiredService<PairingService>();
            var token = context.Request.Query["token"].ToString();
            if (!pairingService.TryValidateToken(token, out var deviceId))
            {
                app.Logger.LogWarning(
                    "Rejected WebSocket handshake with invalid pairing token from {RemoteAddress}.",
                    context.Connection.RemoteIpAddress);
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                await context.Response.WriteAsync("Pairing required.");
                return;
            }

            var connectionRegistry = context.RequestServices.GetRequiredService<WebSocketConnectionRegistry>();
            var handler = context.RequestServices.GetRequiredService<YFRemoteWebSocketHandler>();
            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            var client = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

            // Ein eigener CancellationTokenSource statt direkt context.RequestAborted, damit ein
            // Entkoppeln des Geräts (Tray oder DELETE /pair) diese Verbindung gezielt beenden kann,
            // ohne auf ein Schließen durch den Client warten zu müssen.
            using var connectionCts = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
            using (connectionRegistry.Register(deviceId, connectionCts))
            {
                await handler.HandleAsync(socket, client, connectionCts.Token);
            }
        });

        app.MapPost("/pair", async context =>
        {
            if (!IsAllowedOrigin(context.Request))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsync("Origin not allowed.");
                return;
            }

            var pairingService = context.RequestServices.GetRequiredService<PairingService>();

            PairRequest? request;
            try
            {
                request = await context.Request.ReadFromJsonAsync<PairRequest>(context.RequestAborted);
            }
            catch (JsonException)
            {
                await context.Response.WriteAsJsonAsync(PairResponse.Fail("Invalid JSON."), context.RequestAborted);
                return;
            }

            var clientIp = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            await context.Response.WriteAsJsonAsync(
                pairingService.TryPair(request, clientIp),
                context.RequestAborted);
        });

        app.MapDelete("/pair", async context =>
        {
            if (!IsAllowedOrigin(context.Request))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsync("Origin not allowed.");
                return;
            }

            var token = GetBearerToken(context.Request);
            var pairingService = context.RequestServices.GetRequiredService<PairingService>();

            switch (pairingService.RemoveDeviceByToken(token, out var deviceId))
            {
                case PairingRemovalResult.Removed:
                    context.RequestServices
                        .GetRequiredService<WebSocketConnectionRegistry>()
                        .CloseConnections(deviceId);
                    context.Response.StatusCode = StatusCodes.Status204NoContent;
                    return;
                case PairingRemovalResult.NotFound:
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return;
                case PairingRemovalResult.PersistenceFailed:
                    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                    await context.Response.WriteAsJsonAsync(
                        new
                        {
                            success = false,
                            error = "Entkopplung konnte nicht dauerhaft gespeichert werden. Bitte erneut versuchen."
                        },
                        context.RequestAborted);
                    return;
                default:
                    throw new InvalidOperationException("Unknown pairing removal result.");
            }
        });

        app.MapPost("/files", async context =>
        {
            if (!IsAllowedOrigin(context.Request))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsync("Origin not allowed.");
                return;
            }

            var pairingService = context.RequestServices.GetRequiredService<PairingService>();
            var token = GetBearerToken(context.Request);
            if (!pairingService.TryValidateToken(token, out _))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }

            var fileTransferOptions = context.RequestServices.GetRequiredService<FileTransferOptions>();

            // Kestrel begrenzt einen Request standardmaessig auf rund 30 MB; ohne diese Anhebung
            // wuerde ein groesserer, aber sonst gueltiger Upload schon vor unserer eigenen Pruefung
            // unten abgewiesen.
            context.Features.Get<IHttpMaxRequestBodySizeFeature>()!.MaxRequestBodySize =
                fileTransferOptions.MaxFileSizeBytes;

            if (context.Request.ContentLength is { } contentLength
                && contentLength > fileTransferOptions.MaxFileSizeBytes)
            {
                context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
                await context.Response.WriteAsJsonAsync(
                    FileUploadResponse.Fail("File is too large."),
                    context.RequestAborted);
                return;
            }

            if (!context.Request.HasFormContentType)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsJsonAsync(
                    FileUploadResponse.Fail("Expected multipart/form-data."),
                    context.RequestAborted);
                return;
            }

            var form = await context.Request.ReadFormAsync(context.RequestAborted);
            var file = form.Files.Count > 0 ? form.Files[0] : null;
            if (file is null || file.Length == 0)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsJsonAsync(
                    FileUploadResponse.Fail("No file was sent."),
                    context.RequestAborted);
                return;
            }

            var fileTransferService = context.RequestServices.GetRequiredService<FileTransferService>();
            try
            {
                await using var stream = file.OpenReadStream();
                var savedFileName = await fileTransferService.SaveFileAsync(
                    file.FileName,
                    stream,
                    context.RequestAborted);
                await context.Response.WriteAsJsonAsync(
                    FileUploadResponse.Ok(savedFileName),
                    context.RequestAborted);
            }
            catch (FileTooLargeException)
            {
                context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
                await context.Response.WriteAsJsonAsync(
                    FileUploadResponse.Fail("File is too large."),
                    context.RequestAborted);
            }
        });

        app.MapPost("/clipboard/text", async context =>
        {
            if (!IsAllowedOrigin(context.Request))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsync("Origin not allowed.");
                return;
            }

            var pairingService = context.RequestServices.GetRequiredService<PairingService>();
            var token = GetBearerToken(context.Request);
            if (!pairingService.TryValidateToken(token, out _))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }

            ClipboardTextRequest? request;
            try
            {
                request = await context.Request.ReadFromJsonAsync<ClipboardTextRequest>(context.RequestAborted);
            }
            catch (JsonException)
            {
                await context.Response.WriteAsJsonAsync(ClipboardResponse.Fail("Invalid JSON."), context.RequestAborted);
                return;
            }

            var clipboardOptions = context.RequestServices.GetRequiredService<ClipboardOptions>();
            var text = request?.Text;

            if (string.IsNullOrEmpty(text))
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsJsonAsync(
                    ClipboardResponse.Fail("Text must not be empty."),
                    context.RequestAborted);
                return;
            }

            if (text.Length > clipboardOptions.MaxTextLength)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsJsonAsync(
                    ClipboardResponse.Fail($"Text must be at most {clipboardOptions.MaxTextLength} characters."),
                    context.RequestAborted);
                return;
            }

            var clipboardService = context.RequestServices.GetRequiredService<IClipboardService>();
            await TrySetClipboardAsync(context, app.Logger, () => clipboardService.SetTextAsync(text));
        });

        app.MapPost("/clipboard/image", async context =>
        {
            if (!IsAllowedOrigin(context.Request))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsync("Origin not allowed.");
                return;
            }

            var pairingService = context.RequestServices.GetRequiredService<PairingService>();
            var token = GetBearerToken(context.Request);
            if (!pairingService.TryValidateToken(token, out _))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }

            var clipboardOptions = context.RequestServices.GetRequiredService<ClipboardOptions>();

            context.Features.Get<IHttpMaxRequestBodySizeFeature>()!.MaxRequestBodySize =
                clipboardOptions.MaxImageSizeBytes;

            if (context.Request.ContentLength is { } contentLength
                && contentLength > clipboardOptions.MaxImageSizeBytes)
            {
                context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
                await context.Response.WriteAsJsonAsync(
                    ClipboardResponse.Fail("Image is too large."),
                    context.RequestAborted);
                return;
            }

            if (!context.Request.HasFormContentType)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsJsonAsync(
                    ClipboardResponse.Fail("Expected multipart/form-data."),
                    context.RequestAborted);
                return;
            }

            var form = await context.Request.ReadFormAsync(context.RequestAborted);
            var file = form.Files.Count > 0 ? form.Files[0] : null;
            if (file is null || file.Length == 0)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsJsonAsync(
                    ClipboardResponse.Fail("No image was sent."),
                    context.RequestAborted);
                return;
            }

            // file.Length ist nach ReadFormAsync bereits der tatsaechliche, durch das
            // MaxRequestBodySize-Limit oben begrenzte Wert - kein weiteres manuelles
            // Streaming-Limit noetig (anders als /files, wo gegen einen irrefuehrenden
            // Content-Length-Header auf dem rohen Request abgesichert werden musste).
            if (file.Length > clipboardOptions.MaxImageSizeBytes)
            {
                context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
                await context.Response.WriteAsJsonAsync(
                    ClipboardResponse.Fail("Image is too large."),
                    context.RequestAborted);
                return;
            }

            var clipboardService = context.RequestServices.GetRequiredService<IClipboardService>();
            using var imageStream = new MemoryStream();
            await using (var fileStream = file.OpenReadStream())
            {
                await fileStream.CopyToAsync(imageStream, context.RequestAborted);
            }
            imageStream.Position = 0;

            await TrySetClipboardAsync(context, app.Logger, () => clipboardService.SetImageAsync(imageStream));
        });

        // Keine Origin-Pruefung: Browser senden bei einem Same-Origin-GET-fetch() ueblicherweise
        // keinen Origin-Header (anders als bei POST oder beim WebSocket-Handshake), und dieser
        // Endpoint liefert ohnehin nur ein Ja/Nein zu einem Token, das der Aufrufer bereits kennen
        // muss - ohne den kryptografisch zufaelligen Token laesst sich hieraus nichts gewinnen.
        app.MapGet("/pair/status", async context =>
        {
            var pairingService = context.RequestServices.GetRequiredService<PairingService>();
            var token = context.Request.Query["token"].ToString();
            await context.Response.WriteAsJsonAsync(
                new PairStatusResponse(pairingService.IsValidToken(token)),
                context.RequestAborted);
        });

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

    // WebSocket-Handshakes unterliegen nicht der Same-Origin-Policy des Browsers, daher muss der
    // Origin-Header hier selbst geprueft werden, um Steuerbefehle von fremden Webseiten zu verhindern.
    private static bool IsAllowedOrigin(HttpRequest request)
    {
        var origin = request.Headers.Origin.ToString();
        if (string.IsNullOrEmpty(origin))
        {
            return false;
        }

        var expectedOrigin = $"{request.Scheme}://{request.Host}";
        return string.Equals(origin, expectedOrigin, StringComparison.OrdinalIgnoreCase);
    }

    private static async Task TrySetClipboardAsync(HttpContext context, ILogger logger, Func<Task> operation)
    {
        try
        {
            await operation();
            await context.Response.WriteAsJsonAsync(ClipboardResponse.Ok(), context.RequestAborted);
        }
        catch (NotSupportedException exception)
        {
            context.Response.StatusCode = StatusCodes.Status501NotImplemented;
            await context.Response.WriteAsJsonAsync(
                ClipboardResponse.Fail(exception.Message),
                context.RequestAborted);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Failed to write to the clipboard.");
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            await context.Response.WriteAsJsonAsync(
                ClipboardResponse.Fail("Clipboard operation failed."),
                context.RequestAborted);
        }
    }

    private static string? GetBearerToken(HttpRequest request)
    {
        const string bearerPrefix = "Bearer ";
        var authorization = request.Headers.Authorization.ToString();

        if (!authorization.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var token = authorization[bearerPrefix.Length..].Trim();
        return token.Length == 0 ? null : token;
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
