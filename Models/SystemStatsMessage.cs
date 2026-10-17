namespace YFRemote.Server.Models;

// Auslastung in Prozent, Temperaturen in Grad Celsius, Arbeitsspeicher in MB - an Geraete mit
// eingeschalteter Systemanzeige ("systemStats"). null heisst: dieser PC liefert den Wert nicht
// (CPU-Temperatur unter Windows ohne Admin-Treiber, GPU-Temperatur bei integrierter Grafik, ...).
public sealed record SystemStatsMessage(
    int? CpuLoad,
    int? CpuTemperature,
    int? GpuLoad,
    int? GpuTemperature,
    long MemoryUsedMb,
    long MemoryTotalMb)
{
    public string Type => "systemStats";
}
