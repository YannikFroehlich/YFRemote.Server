namespace YFRemote.Server.Services;

public interface IBrightnessService
{
    // Nur Bildschirme, deren Helligkeit sich lesen laesst: das eingebaute Display zuerst, dann die
    // externen von links nach rechts.
    IReadOnlyList<MonitorBrightness> List();

    // false, wenn der Bildschirm fehlt oder die Helligkeit nicht annimmt.
    bool TrySet(string id, int percent);
}

// Id ist "internal" fuer das eingebaute Display, sonst der Geraetename (\\.\DISPLAY1); Helligkeit in Prozent.
public sealed record MonitorBrightness(string Id, int Brightness);
