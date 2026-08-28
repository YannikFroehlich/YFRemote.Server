using YFRemote.Server.WebSockets;

namespace YFRemote.Server.Tests.WebSockets;

[TestClass]
public sealed class WebSocketConnectionRegistryTests
{
    [TestMethod]
    public void CloseConnections_CancelsAllRegisteredConnectionsForTheDevice()
    {
        var registry = new WebSocketConnectionRegistry();
        var deviceId = Guid.NewGuid();
        using var firstConnection = new CancellationTokenSource();
        using var secondConnection = new CancellationTokenSource();
        using var firstRegistration = registry.Register(deviceId, firstConnection);
        using var secondRegistration = registry.Register(deviceId, secondConnection);

        registry.CloseConnections(deviceId);

        Assert.IsTrue(firstConnection.IsCancellationRequested);
        Assert.IsTrue(secondConnection.IsCancellationRequested);
    }

    [TestMethod]
    public void CloseConnections_DoesNotAffectOtherDevices()
    {
        var registry = new WebSocketConnectionRegistry();
        var closedDeviceId = Guid.NewGuid();
        var otherDeviceId = Guid.NewGuid();
        using var closedConnection = new CancellationTokenSource();
        using var otherConnection = new CancellationTokenSource();
        using var closedRegistration = registry.Register(closedDeviceId, closedConnection);
        using var otherRegistration = registry.Register(otherDeviceId, otherConnection);

        registry.CloseConnections(closedDeviceId);

        Assert.IsTrue(closedConnection.IsCancellationRequested);
        Assert.IsFalse(otherConnection.IsCancellationRequested);
    }

    [TestMethod]
    public void CloseConnections_ForUnknownDevice_DoesNothing()
    {
        var registry = new WebSocketConnectionRegistry();

        registry.CloseConnections(Guid.NewGuid());
    }

    [TestMethod]
    public void DisposingRegistration_StopsTrackingTheConnection()
    {
        var registry = new WebSocketConnectionRegistry();
        var deviceId = Guid.NewGuid();
        using var connection = new CancellationTokenSource();
        var registration = registry.Register(deviceId, connection);

        registration.Dispose();
        registry.CloseConnections(deviceId);

        Assert.IsFalse(connection.IsCancellationRequested);
    }

    [TestMethod]
    public void CloseConnections_IgnoresAlreadyDisposedConnections()
    {
        var registry = new WebSocketConnectionRegistry();
        var deviceId = Guid.NewGuid();
        var disposedConnection = new CancellationTokenSource();
        using var registration = registry.Register(deviceId, disposedConnection);
        disposedConnection.Dispose();

        registry.CloseConnections(deviceId);
    }
}
