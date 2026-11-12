namespace YFRemote.Server.Models;

// Auslastung in Prozent, Temperaturen in Grad Celsius, Arbeitsspeicher in MB - an Geraete mit
// eingeschalteter Systemanzeige ("systemStats"). null heisst: dieser PC liefert den Wert nicht
// (CPU-Temperatur unter Windows ohne Admin-Treiber, GPU-Temperatur bei integrierter Grafik, ...).
// Den Akku gibt es nur bei Laptops; BatteryCharging heisst: haengt am Netz. PowerMode ist der
// Windows-Energiemodus (IPowerService.PowerMode), null ohne umschaltbaren.
public sealed record SystemStatsMessage(
    int? CpuLoad,
    int? CpuTemperature,
    int? GpuLoad,
    int? GpuTemperature,
    long MemoryUsedMb,
    long MemoryTotalMb,
    int? BatteryLevel = null,
    bool? BatteryCharging = null,
    string? PowerMode = null)
{
    public string Type => "systemStats";
}
