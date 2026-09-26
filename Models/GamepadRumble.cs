namespace YFRemote.Server.Models;

// Vibrationswunsch eines Spiels an den virtuellen Controller. Geht ungefragt vom Server an das
// Geraet - die einzige Nachricht ohne vorausgehende Anfrage, daher mit eigenem Type statt Success.
public sealed record GamepadRumble(byte LargeMotor, byte SmallMotor)
{
    public string Type => "rumble";
}
