using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Was der Zwischenablage-Abgleich bei jeder Abfrage meldet: Text, sonst die Kennung eines Bildes,
// sonst null (auch fuer zu langen Text). Mit ChangeCount (Windows) wird der Inhalt nur nach einer
// Aenderung gelesen, sonst bleibt es beim letzten Stand - so kann der Abgleich alle 100 ms fragen,
// und am PC Kopiertes ist am Geraet, bevor man dorthin gewechselt hat.
public static class ClipboardPoll
{
    public static readonly TimeSpan FastInterval = TimeSpan.FromMilliseconds(100);

    public static Func<Task<ClipboardMessage?>> Create(IClipboardService clipboard, int maxTextLength)
    {
        long? lastCount = null;
        ClipboardMessage? last = null;
        return async () =>
        {
            var count = clipboard.ChangeCount;
            if (count is not null && count == lastCount)
            {
                return last;
            }

            last = await clipboard.GetTextAsync() is { Length: > 0 } text
                ? text.Length <= maxTextLength ? new ClipboardMessage(text) : null
                : await clipboard.GetImageIdAsync() is { } imageId
                    ? new ClipboardMessage(null, imageId)
                    : null;
            lastCount = count;
            return last;
        };
    }
}
