using Microsoft.Extensions.Logging.Abstractions;
using YFRemote.Server.Models;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class RemoteActionHandlerTests
{
    [TestMethod]
    public void Handle_SuccessfulAction_EchoesRequestId()
    {
        var inputService = new RecordingInputService();
        var handler = CreateHandler(inputService);

        var response = handler.Handle(new RemoteActionRequest
        {
            RequestId = "macro-1",
            Type = "key",
            Keys = ["ENTER"]
        });

        Assert.IsTrue(response.Success, response.Error);
        Assert.AreEqual("macro-1", response.RequestId);
        Assert.AreEqual("ENTER", inputService.PressedKey);
    }

    [TestMethod]
    public void Handle_RejectedAction_EchoesRequestId()
    {
        var handler = CreateHandler(new RecordingInputService());

        var response = handler.Handle(new RemoteActionRequest
        {
            RequestId = "macro-2",
            Type = "key",
            Keys = []
        });

        Assert.IsFalse(response.Success);
        Assert.AreEqual("macro-2", response.RequestId);
        Assert.AreEqual("Action 'key' requires exactly one key.", response.Error);
    }

    [TestMethod]
    public void Handle_MouseDown_ForwardsButtonToMouseService()
    {
        var mouseService = new RecordingMouseService();
        var handler = CreateHandler(mouseService: mouseService);

        var response = handler.Handle(new RemoteActionRequest { Type = "mouseDown", Button = "left" });

        Assert.IsTrue(response.Success, response.Error);
        Assert.AreEqual("left", mouseService.LastButtonDown);
    }

    [TestMethod]
    public void Handle_MouseUp_ForwardsButtonToMouseService()
    {
        var mouseService = new RecordingMouseService();
        var handler = CreateHandler(mouseService: mouseService);

        var response = handler.Handle(new RemoteActionRequest { Type = "mouseUp", Button = "right" });

        Assert.IsTrue(response.Success, response.Error);
        Assert.AreEqual("right", mouseService.LastButtonUp);
    }

    [TestMethod]
    public void Handle_MouseDown_UnsupportedButton_Fails()
    {
        var handler = CreateHandler();

        var response = handler.Handle(new RemoteActionRequest { Type = "mouseDown", Button = "scroll" });

        Assert.IsFalse(response.Success);
        Assert.AreEqual("Unsupported mouse button: scroll", response.Error);
    }

    [TestMethod]
    public void Handle_MouseScroll_Vertical_ForwardsDeltaToMouseService()
    {
        var mouseService = new RecordingMouseService();
        var handler = CreateHandler(mouseService: mouseService);

        var response = handler.Handle(new RemoteActionRequest { Type = "mouseScroll", Delta = 120 });

        Assert.IsTrue(response.Success, response.Error);
        Assert.AreEqual(120, mouseService.LastScrollDelta);
        Assert.IsNull(mouseService.LastHorizontalScrollDelta);
    }

    [TestMethod]
    public void Handle_MouseScroll_Horizontal_ForwardsDeltaXToMouseService()
    {
        var mouseService = new RecordingMouseService();
        var handler = CreateHandler(mouseService: mouseService);

        var response = handler.Handle(new RemoteActionRequest { Type = "mouseScroll", DeltaX = -90 });

        Assert.IsTrue(response.Success, response.Error);
        Assert.AreEqual(-90, mouseService.LastHorizontalScrollDelta);
        Assert.IsNull(mouseService.LastScrollDelta);
    }

    [TestMethod]
    public void Handle_MouseScroll_VerticalAndHorizontal_ForwardsBothToMouseService()
    {
        var mouseService = new RecordingMouseService();
        var handler = CreateHandler(mouseService: mouseService);

        var response = handler.Handle(new RemoteActionRequest { Type = "mouseScroll", Delta = 30, DeltaX = -30 });

        Assert.IsTrue(response.Success, response.Error);
        Assert.AreEqual(30, mouseService.LastScrollDelta);
        Assert.AreEqual(-30, mouseService.LastHorizontalScrollDelta);
    }

    [TestMethod]
    public void Handle_MouseScroll_NeitherDeltaNorDeltaX_Fails()
    {
        var handler = CreateHandler();

        var response = handler.Handle(new RemoteActionRequest { Type = "mouseScroll" });

        Assert.IsFalse(response.Success);
        Assert.AreEqual("Action 'mouseScroll' requires delta or deltaX.", response.Error);
    }

    [TestMethod]
    public void Handle_MouseScroll_DeltaXOutOfRange_Fails()
    {
        var handler = CreateHandler();

        var response = handler.Handle(new RemoteActionRequest { Type = "mouseScroll", DeltaX = 1201 });

        Assert.IsFalse(response.Success);
        Assert.AreEqual("deltaX must be between -1200 and 1200.", response.Error);
    }

    [TestMethod]
    [DataRow("shutdown")]
    [DataRow("restart")]
    [DataRow("sleep")]
    [DataRow("lock")]
    [DataRow("displayOff")]
    public void Handle_PowerAction_ForwardsToPowerService(string type)
    {
        var powerService = new RecordingPowerService();
        var handler = CreateHandler(powerService: powerService);

        var response = handler.Handle(new RemoteActionRequest { Type = type });

        Assert.IsTrue(response.Success, response.Error);
        Assert.AreEqual(type, powerService.LastAction);
    }

    [TestMethod]
    public void Handle_UnsupportedPowerAction_ReturnsItsMessage()
    {
        var handler = CreateHandler(powerService: new ThrowingPowerService());

        var response = handler.Handle(new RemoteActionRequest { Type = "displayOff" });

        Assert.IsFalse(response.Success);
        Assert.AreEqual("not here", response.Error);
    }

    [TestMethod]
    public void Handle_InputBlockedBySecureDesktop_ReturnsItsMessage()
    {
        var handler = CreateHandler(new BlockedInputService());

        var response = handler.Handle(new RemoteActionRequest { Type = "key", Keys = ["UP"] });

        Assert.IsFalse(response.Success);
        Assert.AreEqual("Input is blocked by a secure desktop (UAC prompt or lock screen).", response.Error);
    }

    [TestMethod]
    public void Handle_Volume_ForwardsToVolumeService()
    {
        var volumeService = new RecordingVolumeService();
        var handler = CreateHandler(volumeService: volumeService);

        var response = handler.Handle(new RemoteActionRequest { Type = "volume", Volume = 42 });

        Assert.IsTrue(response.Success, response.Error);
        Assert.AreEqual(42, volumeService.LastVolume);
    }

    [TestMethod]
    [DataRow(null)]
    [DataRow(-1)]
    [DataRow(101)]
    public void Handle_Volume_OutOfRange_Fails(int? volume)
    {
        var volumeService = new RecordingVolumeService();
        var handler = CreateHandler(volumeService: volumeService);

        var response = handler.Handle(new RemoteActionRequest { Type = "volume", Volume = volume });

        Assert.IsFalse(response.Success);
        Assert.AreEqual("Action 'volume' requires volume between 0 and 100.", response.Error);
        Assert.IsNull(volumeService.LastVolume);
    }

    [TestMethod]
    public void Handle_ShutdownTimer_SchedulesAndCancels()
    {
        using var shutdownTimer = new ShutdownTimer(new RecordingPowerService(), NullLogger<ShutdownTimer>.Instance);
        var handler = CreateHandler(shutdownTimer: shutdownTimer);
        var before = DateTimeOffset.Now;

        var scheduled = handler.Handle(new RemoteActionRequest { Type = "shutdownTimer", Minutes = 30 });

        Assert.IsTrue(scheduled.Success, scheduled.Error);
        Assert.IsNotNull(shutdownTimer.DueAt);
        Assert.IsTrue(shutdownTimer.DueAt >= before.AddMinutes(30));

        var cancelled = handler.Handle(new RemoteActionRequest { Type = "shutdownTimer", Minutes = 0 });

        Assert.IsTrue(cancelled.Success, cancelled.Error);
        Assert.IsNull(shutdownTimer.DueAt);
    }

    [TestMethod]
    [DataRow(null)]
    [DataRow(-1)]
    [DataRow(1441)]
    public void Handle_ShutdownTimer_OutOfRange_Fails(int? minutes)
    {
        using var shutdownTimer = new ShutdownTimer(new RecordingPowerService(), NullLogger<ShutdownTimer>.Instance);
        var handler = CreateHandler(shutdownTimer: shutdownTimer);

        var response = handler.Handle(new RemoteActionRequest { Type = "shutdownTimer", Minutes = minutes });

        Assert.IsFalse(response.Success);
        Assert.AreEqual("Action 'shutdownTimer' requires minutes between 0 and 1440.", response.Error);
        Assert.IsNull(shutdownTimer.DueAt);
    }

    [TestMethod]
    public void Handle_FailingPowerAction_ReturnsFailure()
    {
        var handler = CreateHandler(powerService: new ThrowingPowerService());

        var response = handler.Handle(new RemoteActionRequest { Type = "shutdown" });

        Assert.IsFalse(response.Success);
        Assert.AreEqual("Action failed.", response.Error);
    }

    private sealed class ThrowingPowerService : IPowerService
    {
        public void Shutdown() => throw new InvalidOperationException("nope");

        public void Restart() => throw new InvalidOperationException("nope");

        public void Sleep() => throw new InvalidOperationException("nope");

        public void Lock() => throw new InvalidOperationException("nope");

        public void TurnOffDisplay() => throw new NotSupportedException("not here");
    }

    private sealed class BlockedInputService : IInputService
    {
        public void PressKey(string key) => throw new InputBlockedException();

        public void PressHotkey(IReadOnlyList<string> keys) => throw new InputBlockedException();

        public void TypeText(string text) => throw new InputBlockedException();

        public void KeyDown(string key) => throw new InputBlockedException();

        public void KeyUp(string key) => throw new InputBlockedException();
    }

    private sealed class RecordingVolumeService : IVolumeService
    {
        public int? LastVolume { get; private set; }

        public void SetVolume(int percent)
        {
            LastVolume = percent;
        }
    }

    private static RemoteActionHandler CreateHandler(
        IInputService? inputService = null,
        RecordingMouseService? mouseService = null,
        IPowerService? powerService = null,
        IVolumeService? volumeService = null,
        ShutdownTimer? shutdownTimer = null)
    {
        return new RemoteActionHandler(
            inputService ?? new RecordingInputService(),
            mouseService ?? new RecordingMouseService(),
            powerService ?? new RecordingPowerService(),
            NullLogger<RemoteActionHandler>.Instance,
            volumeService: volumeService,
            shutdownTimer: shutdownTimer);
    }

    private sealed class RecordingPowerService : IPowerService
    {
        public string? LastAction { get; private set; }

        public void Shutdown()
        {
            LastAction = "shutdown";
        }

        public void Restart()
        {
            LastAction = "restart";
        }

        public void Sleep()
        {
            LastAction = "sleep";
        }

        public void Lock()
        {
            LastAction = "lock";
        }

        public void TurnOffDisplay()
        {
            LastAction = "displayOff";
        }
    }

    private sealed class RecordingInputService : IInputService
    {
        public string? PressedKey { get; private set; }

        public void PressKey(string key)
        {
            PressedKey = key;
        }

        public void PressHotkey(IReadOnlyList<string> keys)
        {
        }

        public void TypeText(string text)
        {
        }

        public void KeyDown(string key)
        {
        }

        public void KeyUp(string key)
        {
        }
    }

    private sealed class RecordingMouseService : IMouseService
    {
        public void MoveRelative(int deltaX, int deltaY)
        {
        }

        public void ClickLeft()
        {
        }

        public void ClickRight()
        {
        }

        public void ClickMiddle()
        {
        }

        public string? LastButtonDown { get; private set; }

        public string? LastButtonUp { get; private set; }

        public int? LastScrollDelta { get; private set; }

        public int? LastHorizontalScrollDelta { get; private set; }

        public void ButtonDown(string button)
        {
            LastButtonDown = button;
        }

        public void ButtonUp(string button)
        {
            LastButtonUp = button;
        }

        public void Scroll(int delta)
        {
            LastScrollDelta = delta;
        }

        public void ScrollHorizontal(int delta)
        {
            LastHorizontalScrollDelta = delta;
        }
    }
}
