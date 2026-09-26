namespace YFRemote.Server.Models;

// Vollstaendiger Zustand eines Xbox-Controllers statt einzelner Tasten-Ereignisse: geht eine
// Nachricht verloren, korrigiert die naechste alles, und keine Taste bleibt haengen. Buttons ist
// die XInput-Bitmaske (XINPUT_GAMEPAD_*), die Wertebereiche entsprechen XINPUT_GAMEPAD - Werte
// ausserhalb lehnt schon der JSON-Deserializer ab.
public sealed record GamepadState(
    ushort Buttons,
    short LeftX,
    short LeftY,
    short RightX,
    short RightY,
    byte LeftTrigger,
    byte RightTrigger);
