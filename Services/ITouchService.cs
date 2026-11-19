using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Echte Touch-Eingabe am PC (Tab "Bildschirm", Schalter "Touch"): Windows bekommt Finger und Stift statt
// Mausklicks, sodass Apps ihre eigenen Gesten (Zoomen, Wischen, Kanten) erkennen.
public interface ITouchService
{
    // Beruehrende Finger insgesamt; jede Meldung ersetzt die vorige, fehlende Finger heben ab.
    void Apply(IReadOnlyList<TouchPoint> points, string? monitor);

    // Ein Stift mit Druck, Neigung und Schweben (Windows Ink); null: der Stift ist ausser Reichweite.
    void ApplyPen(PenState? pen, string? monitor);
}
