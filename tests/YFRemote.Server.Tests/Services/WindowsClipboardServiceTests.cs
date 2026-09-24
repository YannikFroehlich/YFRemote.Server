using System.Drawing;
using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

// Diese Tests ueberschreiben kurzzeitig die echte Systemzwischenablage der Maschine, auf der sie
// laufen (STA-Marshaling laesst sich nicht ohne echten Clipboard.SetText/GetImage-Aufruf pruefen).
// Der Testlaeufer-Thread selbst ist nicht STA, deshalb muss auch das Zurueck-Lesen zur Pruefung
// ueber einen eigenen kurzlebigen STA-Thread laufen (RunOnSta) - nicht nur das Schreiben.
// Haelt ein anderes Programm die Zwischenablage laenger als die ~1 s offen, die Clipboard.SetText/
// GetText selbst wiederholen, endet der Test als "nicht aussagekraeftig" statt rot: Auf einem
// Entwickler-PC passierte das in etwa jedem zehnten Lauf, in der CI nie. Um die Verfuegbarkeit
// der Zwischenablage geht es hier nicht, eine ThreadStateException faellt weiter durch.
[TestClass]
public sealed class WindowsClipboardServiceTests
{
    [TestMethod]
    public Task SetTextAsync_MarshalsOntoStaThreadAndWritesRealClipboard() => WithRealClipboardAsync(async () =>
    {
        using var service = new WindowsClipboardService();
        var text = $"YFRemote-Test-{Guid.NewGuid():N}";

        await service.SetTextAsync(text);

        Assert.AreEqual(text, ReadClipboardTextUntil(read => read == text));
    });

    [TestMethod]
    public Task SetImageAsync_MarshalsOntoStaThreadAndWritesRealClipboard() => WithRealClipboardAsync(async () =>
    {
        using var service = new WindowsClipboardService();
        using var originalImage = new Bitmap(4, 4);
        using var pngStream = new MemoryStream();
        originalImage.Save(pngStream, System.Drawing.Imaging.ImageFormat.Png);
        pngStream.Position = 0;

        await service.SetImageAsync(pngStream);

        Assert.IsTrue(RunOnSta(Clipboard.ContainsImage));
    });

    [TestMethod]
    public Task SetTextAsync_CalledConcurrently_CompletesAllWithoutThreadStateException() => WithRealClipboardAsync(async () =>
    {
        using var service = new WindowsClipboardService();

        await Task.WhenAll(Enumerable.Range(0, 5).Select(i => service.SetTextAsync($"concurrent-{i}")));

        // Nur "kein Werfen einer ThreadStateException" ist hier die eigentliche Aussage - welcher
        // der fuenf Werte am Ende gewinnt, ist Zufall (letzter STA-Auftrag in der Warteschlange).
        Assert.IsTrue(ReadClipboardTextUntil(read => read.StartsWith("concurrent-", StringComparison.Ordinal))
            .StartsWith("concurrent-", StringComparison.Ordinal));
    });

    private static async Task WithRealClipboardAsync(Func<Task> test)
    {
        try
        {
            await test();
        }
        catch (ExternalException)
        {
            Assert.Inconclusive("Zwischenablage war von einem anderen Prozess belegt.");
        }
    }

    // Gleicher Entwickler-PC: Direkt nach dem Schreiben war die Zwischenablage gelegentlich kurz
    // leer, weil ein anderes Programm sie gerade neu befuellte. Ein Schreibfehler des Services
    // bleibt auch nach 1 s falsch und laesst den Test weiter scheitern.
    private static string ReadClipboardTextUntil(Func<string, bool> isExpected)
    {
        var read = RunOnSta(Clipboard.GetText);
        for (var attempt = 1; attempt < 10 && !isExpected(read); attempt++)
        {
            Thread.Sleep(100);
            read = RunOnSta(Clipboard.GetText);
        }

        return read;
    }

    private static T RunOnSta<T>(Func<T> func)
    {
        var result = default(T);
        ExceptionDispatchInfo? failure = null;
        var thread = new Thread(() =>
        {
            try
            {
                result = func();
            }
            catch (Exception ex)
            {
                failure = ExceptionDispatchInfo.Capture(ex);
            }
        }) { IsBackground = true };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        failure?.Throw();
        return result!;
    }
}
