using System.Collections.Concurrent;

namespace YFRemote.Server.Services;

// System.Windows.Forms.Clipboard verlangt einen STA-Thread (OLE-Zwischenablage), ASP.NET-Core-
// Request-Handler laufen aber auf gewoehnlichen Threadpool-Threads (MTA). Ein dedizierter
// Hintergrund-STA-Thread nimmt die eigentlichen Clipboard-Aufrufe entgegen; Clipboard.SetText/
// SetImage bringen bereits eine interne Retry-Logik gegen den transienten "eine andere App haelt
// die Zwischenablage gerade offen"-Fehler mit.
public sealed class WindowsClipboardService : IClipboardService, IDisposable
{
    private readonly BlockingCollection<Action> workItems = [];
    private readonly Thread staThread;

    public WindowsClipboardService()
    {
        staThread = new Thread(RunLoop) { IsBackground = true, Name = "YFRemote-Clipboard" };
        staThread.SetApartmentState(ApartmentState.STA);
        staThread.Start();
    }

    public Task SetTextAsync(string text) => RunOnStaThread(() => Clipboard.SetText(text));

    public Task SetImageAsync(Stream imageStream) => RunOnStaThread(() =>
    {
        using var image = Image.FromStream(imageStream);
        Clipboard.SetImage(image);
    });

    public Task<string?> GetTextAsync() =>
        RunOnStaThread(() => Clipboard.ContainsText() ? Clipboard.GetText() : null);

    public void Dispose() => workItems.CompleteAdding();

    private Task RunOnStaThread(Action action) => RunOnStaThread<object?>(() =>
    {
        action();
        return null;
    });

    private Task<T> RunOnStaThread<T>(Func<T> action)
    {
        var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);

        workItems.Add(() =>
        {
            try
            {
                completion.SetResult(action());
            }
            catch (Exception exception)
            {
                completion.SetException(exception);
            }
        });

        return completion.Task;
    }

    private void RunLoop()
    {
        foreach (var workItem in workItems.GetConsumingEnumerable())
        {
            workItem();
        }
    }
}
