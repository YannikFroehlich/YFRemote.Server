using System.Drawing;
using System.Windows.Forms;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

// Diese Tests ueberschreiben kurzzeitig die echte Systemzwischenablage der Maschine, auf der sie
// laufen (STA-Marshaling laesst sich nicht ohne echten Clipboard.SetText/GetImage-Aufruf pruefen).
// Der Testlaeufer-Thread selbst ist nicht STA, deshalb muss auch das Zurueck-Lesen zur Pruefung
// ueber einen eigenen kurzlebigen STA-Thread laufen (RunOnSta) - nicht nur das Schreiben.
[TestClass]
public sealed class WindowsClipboardServiceTests
{
    [TestMethod]
    public async Task SetTextAsync_MarshalsOntoStaThreadAndWritesRealClipboard()
    {
        using var service = new WindowsClipboardService();
        var text = $"YFRemote-Test-{Guid.NewGuid():N}";

        await service.SetTextAsync(text);

        Assert.AreEqual(text, RunOnSta(Clipboard.GetText));
    }

    [TestMethod]
    public async Task SetImageAsync_MarshalsOntoStaThreadAndWritesRealClipboard()
    {
        using var service = new WindowsClipboardService();
        using var originalImage = new Bitmap(4, 4);
        using var pngStream = new MemoryStream();
        originalImage.Save(pngStream, System.Drawing.Imaging.ImageFormat.Png);
        pngStream.Position = 0;

        await service.SetImageAsync(pngStream);

        Assert.IsTrue(RunOnSta(Clipboard.ContainsImage));
    }

    [TestMethod]
    public async Task SetTextAsync_CalledConcurrently_CompletesAllWithoutThreadStateException()
    {
        using var service = new WindowsClipboardService();

        await Task.WhenAll(Enumerable.Range(0, 5).Select(i => service.SetTextAsync($"concurrent-{i}")));

        // Nur "kein Werfen einer ThreadStateException" ist hier die eigentliche Aussage - welcher
        // der fuenf Werte am Ende gewinnt, ist Zufall (letzter STA-Auftrag in der Warteschlange).
        Assert.IsTrue(RunOnSta(Clipboard.GetText).StartsWith("concurrent-", StringComparison.Ordinal));
    }

    private static T RunOnSta<T>(Func<T> func)
    {
        var result = default(T);
        var thread = new Thread(() => result = func()) { IsBackground = true };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        return result!;
    }
}
