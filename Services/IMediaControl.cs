namespace YFRemote.Server.Services;

// Zeitleiste und Cover der laufenden Medien-App, umgesetzt von den Media-Status-Readern.
public interface IMediaControl
{
    // Zuletzt gelesenes Albumcover; null, wenn die App keins liefert.
    MediaCover? Cover { get; }

    // NotSupportedException, wenn keine App laeuft oder sie das Spulen ablehnt.
    void Seek(double seconds);
}

public sealed record MediaCover(byte[] Data, string ContentType, string Id);
