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
    [DataRow("VOLUME_MUTE", true, null)]
    [DataRow("VOLUME_UP", true, null)]
    [DataRow("VOLUME_DOWN", false, "VOLUME_DOWN")]
    public void Handle_VolumeKey_GoesToMixerWhenItTakesOver(string key, bool mixerHandlesKey, string? expectedPressedKey)
    {
        var inputService = new RecordingInputService();
        var volumeService = new RecordingVolumeService(mixerHandlesKey);
        var handler = CreateHandler(inputService, volumeService: volumeService);

        var response = handler.Handle(new RemoteActionRequest { Type = "key", Keys = [key.ToLowerInvariant()] });

        Assert.IsTrue(response.Success, response.Error);
        Assert.AreEqual(key, volumeService.LastVolumeKey);
        Assert.AreEqual(expectedPressedKey, inputService.PressedKey);
    }

    [TestMethod]
    [DataRow(0d)]
    [DataRow(83.5d)]
    [DataRow(86400d)]
    public void Handle_MediaSeek_ForwardsPosition(double position)
    {
        var media = new RecordingMediaControl();
        var handler = CreateHandler(mediaControl: media);

        var response = handler.Handle(new RemoteActionRequest { Type = "mediaSeek", Position = position });

        Assert.IsTrue(response.Success, response.Error);
        Assert.AreEqual(position, media.LastSeek);
    }

    [TestMethod]
    [DataRow(null)]
    [DataRow(-1d)]
    [DataRow(86401d)]
    [DataRow(double.NaN)]
    public void Handle_MediaSeek_OutOfRange_Fails(double? position)
    {
        var media = new RecordingMediaControl();
        var handler = CreateHandler(mediaControl: media);

        var response = handler.Handle(new RemoteActionRequest { Type = "mediaSeek", Position = position });

        Assert.IsFalse(response.Success);
        Assert.IsNull(media.LastSeek);
    }

    [TestMethod]
    [DataRow("1234", 40, null)]
    [DataRow("system", null, true)]
    [DataRow("7", 0, false)]
    public void Handle_AppVolume_ForwardsChange(string id, int? volume, bool? muted)
    {
        var apps = new RecordingAppVolumeService();
        var handler = CreateHandler(appVolumes: apps);

        var response = handler.Handle(new RemoteActionRequest { Type = "appVolume", Id = id, Volume = volume, Muted = muted });

        Assert.IsTrue(response.Success, response.Error);
        Assert.AreEqual((id, volume, muted), apps.LastChange);
    }

    [TestMethod]
    [DataRow(null, 40, null)]
    [DataRow("--help", 40, null)]
    [DataRow("12 34", 40, null)]
    [DataRow("1234", null, null)]
    [DataRow("1234", 101, null)]
    [DataRow("1234", -1, null)]
    public void Handle_AppVolume_RejectsInvalidRequest(string? id, int? volume, bool? muted)
    {
        var apps = new RecordingAppVolumeService();
        var handler = CreateHandler(appVolumes: apps);

        var response = handler.Handle(new RemoteActionRequest { Type = "appVolume", Id = id, Volume = volume, Muted = muted });

        Assert.IsFalse(response.Success);
        Assert.IsNull(apps.LastChange);
    }

    [TestMethod]
    public void Handle_AppVolumeByName_SetsEveryMatchAndTogglesMute()
    {
        var apps = new RecordingAppVolumeService(
            new AppVolume("10", "Firefox", 100, true),
            new AppVolume("11", "firefox", 80, false),
            new AppVolume("12", "Spotify", 50, true));
        var handler = CreateHandler(appVolumes: apps);

        var toggled = handler.Handle(new RemoteActionRequest { Type = "appVolume", Name = " Firefox " });
        var volume = handler.Handle(new RemoteActionRequest { Type = "appVolume", Name = "Spotify", Volume = 30 });

        Assert.IsTrue(toggled.Success, toggled.Error);
        Assert.IsTrue(volume.Success, volume.Error);
        CollectionAssert.AreEqual(
            new (string, int?, bool?)[] { ("10", null, true), ("11", null, true), ("12", 30, null) },
            apps.Changes);
    }

    [TestMethod]
    [DataRow("Discord")]
    [DataRow("")]
    public void Handle_AppVolumeByName_RejectsUnknownName(string name)
    {
        var apps = new RecordingAppVolumeService(new AppVolume("12", "Spotify", 50, false));
        var handler = CreateHandler(appVolumes: apps);

        var response = handler.Handle(new RemoteActionRequest { Type = "appVolume", Name = name, Muted = true });

        Assert.IsFalse(response.Success);
        Assert.IsNull(apps.LastChange);
    }

    [TestMethod]
    [DataRow("{0.0.0.00000000}.{speakers}", true)]
    [DataRow("{0.0.0.00000000}.{other}", false)]
    [DataRow(null, false)]
    public void Handle_AudioOutput_OnlyAcceptsListedDevice(string? id, bool accepted)
    {
        var apps = new RecordingAppVolumeService();
        var handler = CreateHandler(appVolumes: apps);

        var response = handler.Handle(new RemoteActionRequest { Type = "audioOutput", Id = id });

        Assert.AreEqual(accepted, response.Success);
        Assert.AreEqual(accepted ? id : null, apps.Output);
    }

    [TestMethod]
    [DataRow(" spotify ", true)]
    [DataRow("Notepad", false)]
    [DataRow("", false)]
    [DataRow(null, false)]
    public void Handle_LaunchApp_OnlyStartsListedApp(string? name, bool accepted)
    {
        var launcher = new RecordingAppLauncher("Spotify");
        var handler = CreateHandler(appLauncher: launcher);

        var response = handler.Handle(new RemoteActionRequest { Type = "launch", Name = name });

        Assert.AreEqual(accepted, response.Success);
        Assert.AreEqual(accepted ? "Spotify" : null, launcher.Launched);
    }

    [TestMethod]
    [DataRow("https://www.youtube.com/watch?v=1", true)]
    [DataRow("HTTP://example.org", true)]
    [DataRow("file:///C:/Windows/System32/calc.exe", false)]
    [DataRow("javascript:alert(1)", false)]
    [DataRow("ms-settings:", false)]
    [DataRow("example.org", false)]
    public void Handle_LaunchUrl_OnlyOpensHttpAddresses(string url, bool accepted)
    {
        var launcher = new RecordingAppLauncher();
        var handler = CreateHandler(appLauncher: launcher);

        var response = handler.Handle(new RemoteActionRequest { Type = "launch", Url = url });

        Assert.AreEqual(accepted, response.Success);
        Assert.AreEqual(accepted, launcher.OpenedUrl is not null);
    }

    [TestMethod]
    public void Handle_OtherKey_DoesNotAskMixer()
    {
        var volumeService = new RecordingVolumeService(handlesMute: true);
        var handler = CreateHandler(volumeService: volumeService);

        handler.Handle(new RemoteActionRequest { Type = "key", Keys = ["MEDIA_PLAY_PAUSE"] });

        Assert.IsNull(volumeService.LastVolumeKey);
    }

    [TestMethod]
    [DataRow("Strip[3].Mute", null)]
    [DataRow("Strip[0].A1", 1d)]
    [DataRow("Strip[7].B3", 0d)]
    [DataRow("Bus[0].Mute", 1d)]
    [DataRow("Bus[4].Gain", -12.5d)]
    [DataRow("Strip[2].Gain", 12d)]
    public void Handle_VoicemeeterParameter_ForwardsAllowedValues(string parameter, double? value)
    {
        var voicemeeter = new RecordingVoicemeeterService();
        var handler = CreateHandler(voicemeeter: voicemeeter);

        var response = handler.Handle(new RemoteActionRequest
        {
            Type = "voicemeeterParameter",
            Parameter = parameter,
            Value = value
        });

        Assert.IsTrue(response.Success, response.Error);
        Assert.AreEqual(parameter, voicemeeter.LastParameter);
        Assert.AreEqual((float?)value, voicemeeter.LastValue);
    }

    [TestMethod]
    [DataRow("Command.Shutdown", 1d)]
    [DataRow("Strip[3].Label", null)]
    [DataRow("Bus[0].A1", 1d)]
    [DataRow("Strip[8].Mute", 1d)]
    [DataRow("Strip[3].Mute; Command.Shutdown", 1d)]
    [DataRow("Strip[3].Mute", 0.5d)]
    [DataRow("Strip[3].Gain", null)]
    [DataRow("Strip[3].Gain", 13d)]
    [DataRow(null, 1d)]
    public void Handle_VoicemeeterParameter_RejectsAnythingElse(string? parameter, double? value)
    {
        var voicemeeter = new RecordingVoicemeeterService();
        var handler = CreateHandler(voicemeeter: voicemeeter);

        var response = handler.Handle(new RemoteActionRequest
        {
            Type = "voicemeeterParameter",
            Parameter = parameter,
            Value = value
        });

        Assert.IsFalse(response.Success);
        Assert.IsNull(voicemeeter.LastParameter);
    }

    [TestMethod]
    public void Handle_VoicemeeterParameter_NotRunning_Fails()
    {
        var handler = CreateHandler(voicemeeter: new RecordingVoicemeeterService(running: false));

        var response = handler.Handle(new RemoteActionRequest { Type = "voicemeeterParameter", Parameter = "Strip[3].Mute" });

        Assert.IsFalse(response.Success);
        Assert.AreEqual("Voicemeeter is not running.", response.Error);
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

    private sealed class RecordingVolumeService(bool handlesMute = false) : IVolumeService
    {
        public int? LastVolume { get; private set; }

        public string? LastVolumeKey { get; private set; }

        public void SetVolume(int percent)
        {
            LastVolume = percent;
        }

        public bool TryHandleVolumeKey(string key)
        {
            LastVolumeKey = key;
            return handlesMute;
        }
    }

    private sealed class RecordingVoicemeeterService(bool running = true) : IVoicemeeterService
    {
        public string? LastParameter { get; private set; }

        public float? LastValue { get; private set; }

        public bool IsInstalled => true;

        public Task<VoicemeeterMessage> ReadAsync() => Task.FromResult(new VoicemeeterMessage(null, null));

        public void SetParameter(string parameter, float? value)
        {
            if (!running)
            {
                throw new NotSupportedException("Voicemeeter is not running.");
            }

            LastParameter = parameter;
            LastValue = value;
        }
    }

    private sealed class RecordingMediaControl : IMediaControl
    {
        public double? LastSeek { get; private set; }

        public MediaCover? Cover => null;

        public void Seek(double seconds)
        {
            LastSeek = seconds;
        }
    }

    private sealed class RecordingAppVolumeService(params AppVolume[] apps) : IAppVolumeService
    {
        public List<(string Id, int? Volume, bool? Muted)> Changes { get; } = [];

        public (string Id, int? Volume, bool? Muted)? LastChange => Changes.Count > 0 ? Changes[^1] : null;

        public string? Output { get; private set; }

        public Task<AppVolumesMessage> ReadAppsAsync() =>
            Task.FromResult(new AppVolumesMessage(apps, [new AudioOutput("{0.0.0.00000000}.{speakers}", "Lautsprecher", true)]));

        public void SetApp(string id, int? volume, bool? muted)
        {
            Changes.Add((id, volume, muted));
        }

        public void SetOutput(string id)
        {
            Output = id;
        }
    }

    private sealed class RecordingAppLauncher(params string[] apps) : IAppLauncher
    {
        public string? Launched { get; private set; }

        public Uri? OpenedUrl { get; private set; }

        public IReadOnlyList<string> ListApps() => apps;

        public bool TryLaunchApp(string name)
        {
            Launched = apps.FirstOrDefault(app => string.Equals(app, name, StringComparison.OrdinalIgnoreCase));
            return Launched is not null;
        }

        public void OpenUrl(Uri url)
        {
            OpenedUrl = url;
        }
    }

    private static RemoteActionHandler CreateHandler(
        IInputService? inputService = null,
        RecordingMouseService? mouseService = null,
        IPowerService? powerService = null,
        IVolumeService? volumeService = null,
        ShutdownTimer? shutdownTimer = null,
        IVoicemeeterService? voicemeeter = null,
        IMediaControl? mediaControl = null,
        IAppVolumeService? appVolumes = null,
        IAppLauncher? appLauncher = null)
    {
        return new RemoteActionHandler(
            inputService ?? new RecordingInputService(),
            mouseService ?? new RecordingMouseService(),
            powerService ?? new RecordingPowerService(),
            NullLogger<RemoteActionHandler>.Instance,
            volumeService: volumeService,
            shutdownTimer: shutdownTimer,
            voicemeeter: voicemeeter,
            mediaControl: mediaControl,
            appVolumes: appVolumes,
            appLauncher: appLauncher);
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
