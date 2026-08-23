using Serilog;
using Serilog.Events;
using System.Text;

namespace YFRemote.Server.Diagnostics;

internal static class DiagnosticLogging
{
    private const long FileSizeLimitBytes = 10 * 1024 * 1024;
    private const int RetainedFileCount = 14;

    public static void Configure(WebApplicationBuilder builder)
    {
        DiagnosticPaths.EnsureLogDirectory();

        builder.Logging.ClearProviders();
        builder.Logging.AddDebug();
        builder.Services.AddSerilog((_, loggerConfiguration) =>
            ConfigureFileLogger(loggerConfiguration, DiagnosticPaths.RollingLogFilePath));
    }

    internal static LoggerConfiguration ConfigureFileLogger(
        LoggerConfiguration loggerConfiguration,
        string logFilePath)
    {
        ArgumentNullException.ThrowIfNull(loggerConfiguration);
        ArgumentException.ThrowIfNullOrWhiteSpace(logFilePath);

        var logDirectory = Path.GetDirectoryName(Path.GetFullPath(logFilePath));
        if (logDirectory is not null)
        {
            Directory.CreateDirectory(logDirectory);
        }

        return loggerConfiguration
            .MinimumLevel.Information()
            .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
            .Enrich.FromLogContext()
            .WriteTo.File(
                logFilePath,
                outputTemplate:
                    "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] {SourceContext}: {Message:lj}{NewLine}{Exception}",
                fileSizeLimitBytes: FileSizeLimitBytes,
                buffered: false,
                shared: false,
                rollingInterval: RollingInterval.Day,
                rollOnFileSizeLimit: true,
                retainedFileCountLimit: RetainedFileCount,
                encoding: new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }
}
