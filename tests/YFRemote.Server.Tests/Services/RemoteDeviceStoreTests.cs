using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public class RemoteDeviceStoreTests
{
    private string directory = null!;
    private RemoteDeviceStore store = null!;

    [TestInitialize]
    public void Initialize()
    {
        directory = Path.Combine(Path.GetTempPath(), $"YFRemote.Tests.{Guid.NewGuid():N}");
        store = new RemoteDeviceStore(Path.Combine(directory, "remote-devices.json"));
    }

    [TestCleanup]
    public void Cleanup()
    {
        if (Directory.Exists(directory))
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    [TestMethod]
    public void NormalizeAddress_AddsSchemeAndDefaultPort()
    {
        Assert.AreEqual("http://192.168.0.5:5050", RemoteDeviceStore.NormalizeAddress(" 192.168.0.5 "));
        Assert.AreEqual("http://pc.local:5060", RemoteDeviceStore.NormalizeAddress("http://PC.local:5060/"));
        Assert.IsNull(RemoteDeviceStore.NormalizeAddress(""));
        Assert.IsNull(RemoteDeviceStore.NormalizeAddress("https://pc:5443"));
        Assert.IsNull(RemoteDeviceStore.NormalizeAddress("pc:70000"));
        Assert.IsNull(RemoteDeviceStore.NormalizeAddress("pc/pfad"));
        Assert.IsNull(RemoteDeviceStore.NormalizeAddress("mein pc"));
    }

    [TestMethod]
    public void AddRenameRemove_Persist()
    {
        store.Add(new RemoteDevice("http://192.168.0.5:5050", "192.168.0.5:5050"));
        store.SetReportedName("http://192.168.0.5:5050", "HOMESERVER");
        Assert.AreEqual("HOMESERVER", store.Load().Single().Name);

        store.Rename("http://192.168.0.5:5050", "Keller");
        store.SetReportedName("http://192.168.0.5:5050", "HOMESERVER");
        Assert.AreEqual(new RemoteDevice("http://192.168.0.5:5050", "Keller", Named: true), store.Load().Single());

        store.Rename("http://192.168.0.5:5050", " ");
        Assert.AreEqual(new RemoteDevice("http://192.168.0.5:5050", "192.168.0.5:5050"), store.Load().Single());

        store.Remove("http://192.168.0.5:5050");
        Assert.IsEmpty(store.Load());
    }

    [TestMethod]
    public void Load_WithDamagedFile_ReturnsEmptyList()
    {
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, "remote-devices.json"), "{kaputt");

        Assert.IsEmpty(store.Load());
    }
}
