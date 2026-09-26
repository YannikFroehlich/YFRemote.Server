using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Haelt die eine Datei, die der PC gerade den gekoppelten Geraeten anbietet. Eine neue Freigabe
// ersetzt die alte; wie die PIN laeuft sie nach 10 Minuten ab, damit ein Geraet, das sich Stunden
// spaeter verbindet, keine laengst vergessene Datei mehr angeboten bekommt.
public sealed class FileOfferService(TimeProvider timeProvider)
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

    private volatile ActiveOffer? current;

    public event Action<FileOfferMessage>? Offered;

    public event Action<string, string>? Downloaded;

    public FileOfferMessage Offer(string path)
    {
        var file = new FileInfo(path);
        var message = new FileOfferMessage(Guid.NewGuid(), file.Name, file.Length);
        current = new ActiveOffer(message, file.FullName, timeProvider.GetUtcNow() + Lifetime);
        Offered?.Invoke(message);
        return message;
    }

    public FileOfferMessage? Current => GetActive()?.Message;

    public string? TryGetPath(Guid id) => GetActive() is { } offer && offer.Message.Id == id ? offer.Path : null;

    public void NotifyDownloaded(string fileName, string deviceName) => Downloaded?.Invoke(fileName, deviceName);

    private ActiveOffer? GetActive() =>
        current is { } offer && timeProvider.GetUtcNow() < offer.ExpiresAt ? offer : null;

    private sealed record ActiveOffer(FileOfferMessage Message, string Path, DateTimeOffset ExpiresAt);
}
