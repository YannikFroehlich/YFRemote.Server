using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using YFRemote.Server.Models;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class GamepadActionTests
{
    private static readonly GamepadState PressA = new(0x1000, 0, 0, 0, 0, 0, 0);

    [TestMethod]
    public void Gamepad_ConnectsOncePerSessionAndForwardsEveryState()
    {
        var service = new FakeGamepadService();
        var handler = CreateHandler(service);
        using var session = new RemoteActionSession();

        var first = handler.Handle(GamepadRequest(PressA), session);
        var second = handler.Handle(GamepadRequest(PressA with { LeftX = short.MinValue }), session);

        Assert.IsTrue(first.Success, first.Error);
        Assert.IsTrue(second.Success, second.Error);
        Assert.HasCount(1, service.Controllers);
        Assert.HasCount(2, service.Controllers[0].States);
        Assert.AreEqual(short.MinValue, service.Controllers[0].States[1].LeftX);
    }

    [TestMethod]
    public void Gamepad_EachSessionGetsItsOwnController()
    {
        var service = new FakeGamepadService();
        var handler = CreateHandler(service);
        using var firstDevice = new RemoteActionSession();
        using var secondDevice = new RemoteActionSession();

        handler.Handle(GamepadRequest(PressA), firstDevice);
        handler.Handle(GamepadRequest(PressA), secondDevice);

        Assert.HasCount(2, service.Controllers);
    }

    [TestMethod]
    public void Gamepad_ClosingTheSessionUnplugsTheController()
    {
        var service = new FakeGamepadService();
        var handler = CreateHandler(service);
        var session = new RemoteActionSession();

        handler.Handle(GamepadRequest(PressA), session);
        session.Dispose();

        Assert.IsTrue(service.Controllers[0].Disposed);
    }

    [TestMethod]
    public void GamepadDisconnect_UnplugsAndNextStateConnectsAgain()
    {
        var service = new FakeGamepadService();
        var handler = CreateHandler(service);
        using var session = new RemoteActionSession();

        handler.Handle(GamepadRequest(PressA), session);
        var response = handler.Handle(new RemoteActionRequest { Type = "gamepadDisconnect" }, session);
        handler.Handle(GamepadRequest(PressA), session);

        Assert.IsTrue(response.Success, response.Error);
        Assert.IsTrue(service.Controllers[0].Disposed);
        Assert.HasCount(2, service.Controllers);
    }

    [TestMethod]
    public void Gamepad_WithoutGamepadService_IsRejected()
    {
        var handler = CreateHandler(gamepadService: null);
        using var session = new RemoteActionSession();

        var response = handler.Handle(GamepadRequest(PressA), session);

        Assert.IsFalse(response.Success);
        Assert.AreEqual("Gamepad is not supported.", response.Error);
    }

    [TestMethod]
    public void Gamepad_UnavailableDriver_ReportsReason()
    {
        var service = new FakeGamepadService { Unavailable = "Controller driver (ViGEmBus) is not installed." };
        var handler = CreateHandler(service);
        using var session = new RemoteActionSession();

        var response = handler.Handle(GamepadRequest(PressA), session);

        Assert.IsFalse(response.Success);
        Assert.AreEqual("Controller driver (ViGEmBus) is not installed.", response.Error);
    }

    [TestMethod]
    public void Gamepad_WithoutState_IsRejected()
    {
        var service = new FakeGamepadService();
        var handler = CreateHandler(service);
        using var session = new RemoteActionSession();

        var response = handler.Handle(new RemoteActionRequest { Type = "gamepad" }, session);

        Assert.IsFalse(response.Success);
        Assert.IsEmpty(service.Controllers);
    }

    [TestMethod]
    public void GamepadState_ParsesClientWireFormatAndRejectsOutOfRangeAxes()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);

        var request = JsonSerializer.Deserialize<RemoteActionRequest>(
            """{"type":"gamepad","gamepad":{"buttons":4097,"leftX":-32768,"rightY":32767,"rightTrigger":255}}""",
            options);

        Assert.AreEqual(new GamepadState(4097, short.MinValue, 0, 0, short.MaxValue, 0, 255), request!.Gamepad);
        Assert.ThrowsExactly<JsonException>(() => JsonSerializer.Deserialize<RemoteActionRequest>(
            """{"type":"gamepad","gamepad":{"leftX":40000}}""",
            options));
    }

    private static RemoteActionRequest GamepadRequest(GamepadState state) =>
        new() { Type = "gamepad", Gamepad = state };

    private static RemoteActionHandler CreateHandler(IGamepadService? gamepadService) =>
        new(
            new NoOpInputService(),
            new NoOpMouseService(),
            new NoOpPowerService(),
            NullLogger<RemoteActionHandler>.Instance,
            gamepadService);

    private sealed class FakeGamepadService : IGamepadService
    {
        public string? Unavailable { get; init; }

        public List<FakeGamepad> Controllers { get; } = [];

        public bool IsAvailable => Unavailable is null;

        public IVirtualGamepad Connect()
        {
            if (Unavailable is not null)
            {
                throw new GamepadUnavailableException(Unavailable);
            }

            var controller = new FakeGamepad();
            Controllers.Add(controller);
            return controller;
        }
    }

    private sealed class FakeGamepad : IVirtualGamepad
    {
        public List<GamepadState> States { get; } = [];

        public bool Disposed { get; private set; }

        public void Update(GamepadState state) => States.Add(state);

        public void Dispose() => Disposed = true;
    }

    private sealed class NoOpInputService : IInputService
    {
        public void PressKey(string key) { }
        public void PressHotkey(IReadOnlyList<string> keys) { }
        public void TypeText(string text) { }
        public void KeyDown(string key) { }
        public void KeyUp(string key) { }
    }

    private sealed class NoOpMouseService : IMouseService
    {
        public void MoveRelative(int deltaX, int deltaY) { }
        public void ClickLeft() { }
        public void ClickRight() { }
        public void ClickMiddle() { }
        public void ButtonDown(string button) { }
        public void ButtonUp(string button) { }
        public void Scroll(int delta) { }
        public void ScrollHorizontal(int delta) { }
    }

    private sealed class NoOpPowerService : IPowerService
    {
        public void Shutdown() { }
        public void Restart() { }
        public void Sleep() { }
    }
}
