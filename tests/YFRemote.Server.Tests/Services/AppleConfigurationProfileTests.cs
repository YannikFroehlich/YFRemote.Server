using System.Security.Cryptography.X509Certificates;
using System.Xml.Linq;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class AppleConfigurationProfileTests
{
    [TestMethod]
    public void Create_WrapsTheAuthorityAsRootCertificatePayload()
    {
        using var authority = LocalCertificateAuthority.CreateAuthority(DateTimeOffset.UtcNow);
        var der = authority.Export(X509ContentType.Cert);

        var profile = Parse(AppleConfigurationProfile.Create(der));
        var payload = Values(profile.Element("array")!.Element("dict")!);

        Assert.AreEqual("Configuration", Values(profile)["PayloadType"].Value);
        Assert.AreEqual("com.apple.security.root", payload["PayloadType"].Value);
        CollectionAssert.AreEqual(der, Convert.FromBase64String(payload["PayloadContent"].Value));
    }

    [TestMethod]
    public void Create_KeepsTheSameUuidsForTheSameAuthority()
    {
        using var authority = LocalCertificateAuthority.CreateAuthority(DateTimeOffset.UtcNow);
        using var other = LocalCertificateAuthority.CreateAuthority(DateTimeOffset.UtcNow);
        var der = authority.Export(X509ContentType.Cert);

        var first = Values(Parse(AppleConfigurationProfile.Create(der)))["PayloadUUID"].Value;
        var again = Values(Parse(AppleConfigurationProfile.Create(der)))["PayloadUUID"].Value;
        var different = Values(Parse(AppleConfigurationProfile.Create(other.Export(X509ContentType.Cert))))["PayloadUUID"].Value;

        Assert.AreEqual(first, again);
        Assert.AreNotEqual(first, different);
        Assert.IsTrue(Guid.TryParse(first, out _));
    }

    // Die oberste dict unter plist.
    private static XElement Parse(byte[] bytes)
    {
        using var stream = new MemoryStream(bytes);
        var document = XDocument.Load(stream);
        Assert.AreEqual("plist", document.DocumentType?.Name);
        return document.Root!.Element("dict")!;
    }

    private static Dictionary<string, XElement> Values(XElement dict) =>
        dict.Elements("key").ToDictionary(key => key.Value, key => (XElement)key.NextNode!);
}
