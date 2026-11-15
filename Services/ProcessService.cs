using System.ComponentModel;
using System.Diagnostics;

namespace YFRemote.Server.Services;

public interface IProcessService
{
    // Die Prozesse mit der hoechsten CPU-Last, bei gleicher Last die mit dem meisten Arbeitsspeicher.
    Task<IReadOnlyList<ProcessInfo>> ListAsync(CancellationToken cancellationToken);

    // false, wenn es den Prozess nicht mehr gibt oder die Nummer inzwischen einem anderen gehoert.
    bool TryKill(int id, string name);
}

// Cpu in Prozent aller Kerne zusammen, wie im Task-Manager.
public sealed record ProcessInfo(int Id, string Name, int Cpu, long MemoryMb);

// Nur System.Diagnostics, deshalb fuer Windows und Linux gemeinsam. Prozesse, deren Werte das
// System nicht herausgibt (Systemprozesse, hoehere Rechte), fehlen in der Liste.
public sealed class ProcessService : IProcessService
{
    private const int MaxProcesses = 15;

    // Die CPU-Last ergibt sich erst aus zwei Messungen; gemessen wird nur auf Anfrage, nicht laufend.
    private static readonly TimeSpan SampleTime = TimeSpan.FromMilliseconds(500);

    public async Task<IReadOnlyList<ProcessInfo>> ListAsync(CancellationToken cancellationToken)
    {
        var before = new Dictionary<int, TimeSpan>();
        ForEachProcess(process => before[process.Id] = process.TotalProcessorTime);
        var started = Stopwatch.GetTimestamp();
        await Task.Delay(SampleTime, cancellationToken);
        var elapsed = Stopwatch.GetElapsedTime(started);

        var processes = new List<ProcessInfo>();
        ForEachProcess(process =>
        {
            if (process.Id != Environment.ProcessId && before.TryGetValue(process.Id, out var cpuBefore))
            {
                processes.Add(new ProcessInfo(
                    process.Id,
                    process.ProcessName,
                    CpuPercent(process.TotalProcessorTime - cpuBefore, elapsed, Environment.ProcessorCount),
                    process.WorkingSet64 / (1024 * 1024)));
            }
        });

        return processes
            .OrderByDescending(process => process.Cpu)
            .ThenByDescending(process => process.MemoryMb)
            .Take(MaxProcesses)
            .ToList();
    }

    // Der Name muss noch stimmen: Zwischen Liste und Tipp kann der Prozess enden und das System
    // seine Nummer neu vergeben - dann traefe es ein fremdes Programm.
    public bool TryKill(int id, string name)
    {
        if (id == Environment.ProcessId)
        {
            return false;
        }

        try
        {
            using var process = Process.GetProcessById(id);
            if (process.ProcessName != name)
            {
                return false;
            }

            process.Kill();
            return true;
        }
        catch (ArgumentException)
        {
            return false;
        }
        catch (Exception exception) when (exception is Win32Exception or InvalidOperationException)
        {
            throw new InvalidOperationException("The system refused to end this process.", exception);
        }
    }

    internal static int CpuPercent(TimeSpan cpu, TimeSpan elapsed, int processors) =>
        elapsed <= TimeSpan.Zero
            ? 0
            : (int)Math.Clamp(Math.Round(100 * cpu.TotalMilliseconds / (elapsed.TotalMilliseconds * processors)), 0, 100);

    private static void ForEachProcess(Action<Process> use)
    {
        foreach (var process in Process.GetProcesses())
        {
            using (process)
            {
                try
                {
                    use(process);
                }
                catch (Exception exception) when (exception is Win32Exception or InvalidOperationException or NotSupportedException)
                {
                    // Zugriff verweigert oder gerade beendet: dieser Prozess fehlt dann einfach.
                }
            }
        }
    }
}
