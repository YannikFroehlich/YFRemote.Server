namespace YFRemote.Server.Services;

// ponytail: xclip/wl-copy per Process.Start waeren moeglich, aber je nach Desktop-Umgebung
// unzuverlaessig (X11 vs. Wayland, Tool ggf. nicht installiert) - lieber ehrlich ablehnen als
// eine bruechige Huerde vortaeuschen. Nachruesten, sobald es echten Bedarf dafuer gibt.
public sealed class LinuxClipboardService : IClipboardService
{
    public Task SetTextAsync(string text) => throw NotSupported();

    public Task SetImageAsync(Stream imageStream) => throw NotSupported();

    private static NotSupportedException NotSupported() =>
        new("Clipboard sync is not supported on Linux yet.");
}
