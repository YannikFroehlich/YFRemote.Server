using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class WindowsSystemStatsReaderTests
{
    [TestMethod]
    public void SumGpuLoad_SumsProcessesPerEngineAndTakesTheBusiestEngine()
    {
        var load = WindowsSystemStatsReader.SumGpuLoad(
        [
            ("pid_10_luid_0x00000000_0x0000D1B5_phys_0_eng_0_engtype_3D", 30.4),
            ("pid_20_luid_0x00000000_0x0000D1B5_phys_0_eng_0_engtype_3D", 25.0),
            ("pid_10_luid_0x00000000_0x0000D1B5_phys_0_eng_3_engtype_VideoDecode", 70.0),
            ("_Total", 99.0)
        ]);

        Assert.AreEqual(70, load);
        Assert.IsNull(WindowsSystemStatsReader.SumGpuLoad([]));
    }

    [TestMethod]
    public void SumGpuLoad_CapsAt100()
    {
        Assert.AreEqual(100, WindowsSystemStatsReader.SumGpuLoad(
        [
            ("pid_1_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 80.0),
            ("pid_2_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 80.0)
        ]));
    }

    // Liest nur - die echten Windows-Schnittstellen muessen auf jedem Rechner ohne Adminrechte
    // antworten, auch ohne Grafiktreiber.
    [TestMethod]
    public async Task ReadAsync_ReportsMemoryAndCpuLoadFromTheSecondReadOn()
    {
        using var reader = new WindowsSystemStatsReader();

        var first = await reader.ReadAsync();
        await Task.Delay(200);
        var second = await reader.ReadAsync();

        Assert.IsNull(first.CpuLoad);
        Assert.IsNotNull(second.CpuLoad);
        Assert.IsTrue(second.CpuLoad is >= 0 and <= 100);
        Assert.IsTrue(second.MemoryTotalMb > 0);
        Assert.IsTrue(second.MemoryUsedMb > 0 && second.MemoryUsedMb <= second.MemoryTotalMb);
    }

    // Ausschnitt aus einer echten data.json von LibreHardwareMonitor 0.9.6 (deutsches Windows).
    [TestMethod]
    public void ParseSensorToolTemperatures_PrefersCpuPackageAndGpuCore()
    {
        var (cpu, gpu) = WindowsSystemStatsReader.ParseSensorToolTemperatures("""
            {"id":0,"Text":"Sensor","Value":"Value","Children":[{"id":1,"Text":"PC","Value":"","Children":[
              {"id":3,"Text":"Intel Core i5-10210U","Value":"","HardwareId":"/intelcpu/0","Children":[
                {"id":21,"Text":"Temperatures","Value":"","Children":[
                  {"id":22,"Text":"Core Max","Value":"58,0 °C","SensorId":"/intelcpu/0/temperature/0","Type":"Temperature","Children":[]},
                  {"id":28,"Text":"CPU Package","Value":"55,4 °C","SensorId":"/intelcpu/0/temperature/6","Type":"Temperature","Children":[]},
                  {"id":29,"Text":"CPU Core #1 Distance to TjMax","Value":"47,0 °C","SensorId":"/intelcpu/0/temperature/7","Type":"Temperature","Children":[]}]},
                {"id":33,"Text":"Load","Value":"","Children":[
                  {"id":34,"Text":"CPU Total","Value":"12,3 %","SensorId":"/intelcpu/0/load/0","Type":"Load","Children":[]}]}]},
              {"id":40,"Text":"NVIDIA GeForce RTX 3070","Value":"","HardwareId":"/gpu-nvidia/0","Children":[
                {"id":41,"Text":"Temperatures","Value":"","Children":[
                  {"id":42,"Text":"GPU Hot Spot","Value":"71.5 °C","SensorId":"/gpu-nvidia/0/temperature/2","Type":"Temperature","Children":[]},
                  {"id":43,"Text":"GPU Core","Value":"62.6 °C","SensorId":"/gpu-nvidia/0/temperature/0","Type":"Temperature","Children":[]}]}]},
              {"id":98,"Text":"SSD","Value":"","HardwareId":"/nvme/0","Children":[
                {"id":100,"Text":"Composite Temperature","Value":"33,0 °C","SensorId":"/nvme/0/temperature/0","Type":"Temperature","Children":[]}]}]}]}
            """);

        Assert.AreEqual(55, cpu);
        Assert.AreEqual(63, gpu);
    }

    [TestMethod]
    public void ParseSensorToolTemperatures_FallsBackToTheHottestSensorAndIgnoresZero()
    {
        var (cpu, gpu) = WindowsSystemStatsReader.ParseSensorToolTemperatures("""
            {"Children":[
              {"Text":"CCD1 (Tdie)","Value":"61,0 °C","SensorId":"/amdcpu/0/temperature/2","Type":"Temperature"},
              {"Text":"CCD2 (Tdie)","Value":"66,0 °C","SensorId":"/amdcpu/0/temperature/3","Type":"Temperature"},
              {"Text":"GPU Core","Value":"0,0 °C","SensorId":"/gpu-intel-integrated/0/temperature/0","Type":"Temperature"}]}
            """);

        Assert.AreEqual(66, cpu);
        Assert.IsNull(gpu);
    }
}
