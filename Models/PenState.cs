namespace YFRemote.Server.Models;

// Der Stift im Tab "Bildschirm" mit "Touch": X/Y 0-1 auf dem Monitor wie screenClick, Pressure 0-1,
// TiltX/TiltY -90 bis 90 Grad wie PointerEvent. Contact: die Spitze (oder der Radierer) beruehrt.
public sealed record PenState(
    double X,
    double Y,
    double Pressure = 0,
    double TiltX = 0,
    double TiltY = 0,
    bool Contact = false,
    bool Barrel = false,
    bool Eraser = false);
