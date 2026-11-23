using System.Net;
using System.Security.Cryptography.X509Certificates;
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
    public void SetHttps_PinsTheFirstAuthorityAndFollowsThePort()
    {
        store.Add(new RemoteDevice("http://192.168.0.5:5050", "PC"));
        Assert.AreEqual("http://192.168.0.5:5050", store.Load().Single().OpenUrl);

        store.SetHttps("http://192.168.0.5:5050", "Q0E=", 5443);
        Assert.AreEqual("https://192.168.0.5:5443", store.Load().Single().OpenUrl);

        // Eine andere CA ersetzt die gemerkte nicht; ohne HTTPS-Port geht es wieder ueber http.
        store.SetHttps("http://192.168.0.5:5050", "QU5ERVJF", null);
        Assert.AreEqual(new RemoteDevice("http://192.168.0.5:5050", "PC", Ca: "Q0E=", HttpsPort: null), store.Load().Single());
        Assert.AreEqual("http://192.168.0.5:5050", store.Load().Single().OpenUrl);
    }

    [TestMethod]
    public void PinnedCertificate_AcceptsOnlyThePinnedAuthorityAndCoveredHost()
    {
        var now = DateTimeOffset.UtcNow;
        using var authority = LocalCertificateAuthority.CreateAuthority(now);
        using var otherAuthority = LocalCertificateAuthority.CreateAuthority(now);
        using var server = LocalCertificateAuthority.IssueServerCertificate(authority, [IPAddress.Parse("192.168.0.5")], now);
        using var publicAuthority = X509CertificateLoader.LoadCertificate(authority.RawData);

        Assert.IsTrue(PinnedCertificate.IsIssuedBy(server, publicAuthority, "192.168.0.5"));
        Assert.IsFalse(PinnedCertificate.IsIssuedBy(server, publicAuthority, "192.168.0.6"));
        Assert.IsFalse(PinnedCertificate.IsIssuedBy(server, otherAuthority, "192.168.0.5"));
    }

    [TestMethod]
    public void ToPinnedAuthority_RejectsServerCertificates()
    {
        var now = DateTimeOffset.UtcNow;
        using var authority = LocalCertificateAuthority.CreateAuthority(now);
        using var server = LocalCertificateAuthority.IssueServerCertificate(authority, [IPAddress.Parse("192.168.0.5")], now);

        Assert.AreEqual(Convert.ToBase64String(authority.RawData), PinnedCertificate.ToPinnedAuthority(authority.RawData));
        Assert.IsNull(PinnedCertificate.ToPinnedAuthority(server.RawData));
        Assert.IsNull(PinnedCertificate.ToPinnedAuthority("kein Zertifikat"u8.ToArray()));
    }

    [TestMethod]
    public void Load_WithDamagedFile_ReturnsEmptyList()
    {
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, "remote-devices.json"), "{kaputt");

        Assert.IsEmpty(store.Load());
    }
}
