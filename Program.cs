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

        var app = builder.Build();

        app.UseDefaultFiles();
        app.UseStaticFiles();
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

            var handler = context.RequestServices.GetRequiredService<YFRemoteWebSocketHandler>();
            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            var client = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

            await handler.HandleAsync(socket, client, context.RequestAborted);
        });

        var indexPath = Path.Combine(app.Environment.WebRootPath, "index.html");
        if (File.Exists(indexPath))
        {
            app.MapFallbackToFile("index.html");
        }

        app.Logger.LogInformation("YFRemote.Server starting on {Url}", serverOptions.Url);

        return app;
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
