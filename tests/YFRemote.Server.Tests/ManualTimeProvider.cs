namespace YFRemote.Server.Tests;

internal sealed class ManualTimeProvider(DateTimeOffset initialTime) : TimeProvider
{
    private DateTimeOffset utcNow = initialTime;

    public override DateTimeOffset GetUtcNow() => utcNow;

    public void Advance(TimeSpan duration) => utcNow = utcNow.Add(duration);
}
