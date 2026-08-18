using YFRemote.Server.Configuration;
using YFRemote.Server.Models;
using YFRemote.Server.Services;
using YFRemote.Server.WebSockets;

var builder = WebApplication.CreateBuilder(args);

builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole();

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

app.Logger.LogInformation("YFRemote.Server starting on {Url}", serverOptions.Url);

app.Run();
