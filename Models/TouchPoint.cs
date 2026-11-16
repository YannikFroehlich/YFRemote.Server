namespace YFRemote.Server.Models;

// Ein Finger im Tab "Bildschirm": Id 0-9, solange er liegt gleich; X/Y 0-1 auf dem Monitor wie screenClick.
public sealed record TouchPoint(int Id, double X, double Y);
