using Nefarius.ViGEm.Client;
using Nefarius.ViGEm.Client.Exceptions;
using Nefarius.ViGEm.Client.Targets;
using Nefarius.ViGEm.Client.Targets.Xbox360;
using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Windows hat keine API fuer virtuelle XInput-Controller; der ViGEmBus-Treiber steckt sie als
// echte Xbox-360-Controller an. Ohne installierten Treiber bleibt der Controller-Modus aus.
public sealed class WindowsGamepadService(ILogger<WindowsGamepadService> logger) : IGamepadService, IDisposable
{
    // XInput kennt nur vier Spielerplaetze, ein fuenfter Controller waere fuer Spiele unsichtbar.
    internal const int MaxControllers = 4;

    private readonly Lock gate = new();
    private ViGEmClient? client;
    private int connectedCount;

    public bool IsAvailable
    {
        get
        {
            lock (gate)
            {
                return TryGetClient() is not null;
            }
        }
    }

    public IVirtualGamepad Connect(Action<GamepadRumble> onRumble)
    {
        lock (gate)
        {
            var bus = TryGetClient()
                ?? throw new GamepadUnavailableException("Controller driver (ViGEmBus) is not installed.");

            if (connectedCount >= MaxControllers)
            {
                throw new GamepadUnavailableException($"All {MaxControllers} controller slots are in use.");
            }

            var controller = bus.CreateXbox360Controller();
            controller.AutoSubmitReport = false;
            // Vor Connect abonnieren: manche Spiele setzen die Vibration gleich beim Anstecken.
            var gamepad = new VirtualGamepad(this, controller, onRumble);
            controller.FeedbackReceived += gamepad.OnFeedback;
            controller.Connect();
            connectedCount++;
            logger.LogInformation("Virtual Xbox controller connected ({Count}/{Max}).", connectedCount, MaxControllers);

            return gamepad;
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            client?.Dispose();
            client = null;
        }
    }

    // Bei jedem Aufruf neu versucht, solange der Treiber fehlt: nach dessen Installation ueber das
    // Tray-Menue funktioniert der Controller-Modus dann ohne Neustart.
    private ViGEmClient? TryGetClient()
    {
        if (client is not null)
        {
            return client;
        }

        try
        {
            client = new ViGEmClient();
        }
        catch (VigemBusNotFoundException)
        {
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "ViGEmBus is installed but could not be opened.");
        }

        return client;
    }

    private void Release(IXbox360Controller controller, Xbox360FeedbackReceivedEventHandler onFeedback)
    {
        lock (gate)
        {
            connectedCount--;
        }

        try
        {
            controller.FeedbackReceived -= onFeedback;
            controller.Disconnect();
        }
        catch (Exception exception)
        {
            // Ein bereits entfernter Controller (z. B. Treiber neu gestartet) darf das Schliessen
            // der Verbindung nicht abbrechen.
            logger.LogWarning(exception, "Failed to disconnect virtual Xbox controller.");
        }

        logger.LogInformation("Virtual Xbox controller disconnected.");
    }

    private sealed class VirtualGamepad(
        WindowsGamepadService owner,
        IXbox360Controller controller,
        Action<GamepadRumble> onRumble) : IVirtualGamepad
    {
        private bool disposed;
        private int lastRumble;

        // Viele Spiele setzen dieselbe Vibration in jedem Frame erneut; nur Aenderungen gehen
        // ans Geraet, sonst liefe der Socket voll.
        public void OnFeedback(object sender, Xbox360FeedbackReceivedEventArgs e)
        {
            var rumble = e.LargeMotor << 8 | e.SmallMotor;
            if (Interlocked.Exchange(ref lastRumble, rumble) == rumble)
            {
                return;
            }

            onRumble(new GamepadRumble(e.LargeMotor, e.SmallMotor));
        }

        public void Update(GamepadState state)
        {
            ObjectDisposedException.ThrowIf(disposed, this);

            controller.SetButtonsFull(state.Buttons);
            controller.SetAxisValue(Xbox360Axis.LeftThumbX, state.LeftX);
            controller.SetAxisValue(Xbox360Axis.LeftThumbY, state.LeftY);
            controller.SetAxisValue(Xbox360Axis.RightThumbX, state.RightX);
            controller.SetAxisValue(Xbox360Axis.RightThumbY, state.RightY);
            controller.SetSliderValue(Xbox360Slider.LeftTrigger, state.LeftTrigger);
            controller.SetSliderValue(Xbox360Slider.RightTrigger, state.RightTrigger);
            controller.SubmitReport();
        }

        public void Dispose()
        {
            if (disposed)
            {
                return;
            }

            disposed = true;
            owner.Release(controller, OnFeedback);
        }
    }
}
