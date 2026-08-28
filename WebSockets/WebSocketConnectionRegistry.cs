namespace YFRemote.Server.WebSockets;

// Erlaubt es, offene /ws-Verbindungen eines Geräts gezielt zu beenden (z.B. beim Entkoppeln
// im Tray), ohne dass der Client selbst die Verbindung schließt.
public sealed class WebSocketConnectionRegistry
{
    private readonly object syncRoot = new();
    private readonly Dictionary<Guid, List<CancellationTokenSource>> connectionsByDeviceId = new();

    public IDisposable Register(Guid deviceId, CancellationTokenSource connectionCts)
    {
        lock (syncRoot)
        {
            if (!connectionsByDeviceId.TryGetValue(deviceId, out var connections))
            {
                connections = [];
                connectionsByDeviceId[deviceId] = connections;
            }

            connections.Add(connectionCts);
        }

        return new Registration(this, deviceId, connectionCts);
    }

    public void CloseConnections(Guid deviceId)
    {
        List<CancellationTokenSource>? connections;
        lock (syncRoot)
        {
            if (!connectionsByDeviceId.TryGetValue(deviceId, out var tracked))
            {
                return;
            }

            connections = [.. tracked];
        }

        foreach (var connectionCts in connections)
        {
            try
            {
                connectionCts.Cancel();
            }
            catch (ObjectDisposedException)
            {
                // Verbindung wurde zwischen dem Erfassen der Liste und dem Abbruch bereits beendet.
            }
        }
    }

    private void Unregister(Guid deviceId, CancellationTokenSource connectionCts)
    {
        lock (syncRoot)
        {
            if (!connectionsByDeviceId.TryGetValue(deviceId, out var connections))
            {
                return;
            }

            connections.Remove(connectionCts);
            if (connections.Count == 0)
            {
                connectionsByDeviceId.Remove(deviceId);
            }
        }
    }

    private sealed class Registration(
        WebSocketConnectionRegistry registry,
        Guid deviceId,
        CancellationTokenSource connectionCts) : IDisposable
    {
        public void Dispose() => registry.Unregister(deviceId, connectionCts);
    }
}
