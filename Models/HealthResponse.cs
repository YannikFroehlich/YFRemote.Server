namespace YFRemote.Server.Models;

// Platform sagt dem Client, welche Aktionen die Gegenstelle ueberhaupt ausfuehren kann
// ("windows", "linux", "android") - der Remote-Tab blendet danach sein Layout um.
public sealed record HealthResponse(string Status, string Service, string Platform);
