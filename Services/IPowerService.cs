namespace YFRemote.Server.Services;

public interface IPowerService
{
    void Shutdown();

    void Restart();

    void Sleep();

    void Lock();

    void TurnOffDisplay();

    // Energiemodus "efficiency"/"balanced"/"performance", null wenn dieser PC keinen umschaltbaren hat.
    string? PowerMode => null;

    void SetPowerMode(string mode) => throw new NotSupportedException("Power mode is not supported on this system.");
}
