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

    // Wie Win+P: "internal" (nur PC-Bildschirm), "clone", "extend", "external" (nur zweiter
    // Bildschirm); null, wenn das System ihn nicht meldet.
    string? DisplayMode => null;

    void SetDisplayMode(string mode) => throw new NotSupportedException("Display mode is not supported on this system.");
}
