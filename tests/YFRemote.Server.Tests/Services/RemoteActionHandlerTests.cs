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

    private static RemoteActionHandler CreateHandler(
        IInputService? inputService = null,
        RecordingMouseService? mouseService = null)
    {
        return new RemoteActionHandler(
            inputService ?? new RecordingInputService(),
            mouseService ?? new RecordingMouseService(),
            NullLogger<RemoteActionHandler>.Instance);
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
        }
    }
}
