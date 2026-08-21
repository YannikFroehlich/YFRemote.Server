using Microsoft.Extensions.FileProviders;
using System.Text.Json;
using Velopack;
using YFRemote.Server.Configuration;
using YFRemote.Server.Models;
using YFRemote.Server.Services;
using YFRemote.Server.Tray;
using YFRemote.Server.WebSockets;

namespace YFRemote.Server;

internal static class Program
{
    private const string SingleInstanceMutexName = "YFRemote.Server.SingleInstance";

    [STAThread]
    private static void Main(string[] args)
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
            app = BuildApplication(args);
            app.StartAsync().GetAwaiter().GetResult();

            using var trayContext = new TrayApplicationContext(app);
            Application.Run(trayContext);
        }
        catch (Exception exception)
        {
            WriteStartupError(exception);
            MessageBox.Show(
                $"YFRemote konnte nicht gestartet werden.\n\n{exception.Message}",
                "YFRemote - Startfehler",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
        finally
        {
            if (app is not null)
            {
                StopAndDisposeApplication(app);
            }
        }
    }

    private static void WriteStartupError(Exception exception)
    {
        try
        {
            var logDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "YFRemote",
                "Logs");
            Directory.CreateDirectory(logDirectory);

            var logPath = Path.Combine(logDirectory, "startup-error.log");
            File.AppendAllText(
                logPath,
                $"[{DateTimeOffset.Now:O}] {exception}{Environment.NewLine}{Environment.NewLine}");
        }
        catch
        {
            // Das Schreiben eines Diagnoseprotokolls darf den Startfehler nicht verdecken.
        }
    }

    private static WebApplication BuildApplication(string[] args)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            Args = args,
            ContentRootPath = AppContext.BaseDirectory,
            WebRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot")
        });

        builder.Logging.ClearProviders();
        builder.Logging.AddDebug();

        var serverOptions = builder.Configuration
            .GetSection(ServerOptions.SectionName)
            .Get<ServerOptions>() ?? new ServerOptions();
        serverOptions.Validate();

        builder.WebHost.UseUrls(serverOptions.Url);

        builder.Services.AddSingleton(serverOptions);
        builder.Services.AddSingleton<WindowsInputSender>();
        builder.Services.AddSingleton<IInputService, WindowsInputService>();
        builder.Services.AddSingleton<IMouseService, WindowsMouseService>();
        builder.Services.AddSingleton<RemoteActionHandler>();
        builder.Services.AddSingleton<YFRemoteWebSocketHandler>();
        builder.Services.AddSingleton<PairingService>();

        var app = builder.Build();

        app.UseDefaultFiles();
        app.UseStaticFiles();
        UseTestToolIfPresent(app);
        app.UseWebSockets(new WebSocketOptions
        {
            KeepAliveInterval = TimeSpan.FromSeconds(30)
        });

        app.MapGet("/health", () => new HealthResponse("ok", "YFRemote.Server"));

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
            if (!pairingService.IsValidToken(token))
            {
                app.Logger.LogWarning(
                    "Rejected WebSocket handshake with invalid pairing token from {RemoteAddress}.",
                    context.Connection.RemoteIpAddress);
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                await context.Response.WriteAsync("Pairing required.");
                return;
            }

            var handler = context.RequestServices.GetRequiredService<YFRemoteWebSocketHandler>();
            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            var client = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

            await handler.HandleAsync(socket, client, context.RequestAborted);
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
}
