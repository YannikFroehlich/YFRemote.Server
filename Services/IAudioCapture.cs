namespace YFRemote.Server.Services;

public interface IAudioCapture
{
    // Schneidet mit, was der PC gerade abspielt, als 16-Bit-PCM (little-endian, Kanaele
    // verschraenkt), bis cancellationToken abbricht. started bekommt Abtastrate und Kanalzahl,
    // bevor write das erste Mal aufgerufen wird.
    Task CaptureAsync(
        Action<int, int> started,
        Func<ReadOnlyMemory<byte>, Task> write,
        CancellationToken cancellationToken);
}
