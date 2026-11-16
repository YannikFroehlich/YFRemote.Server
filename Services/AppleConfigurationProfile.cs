using System.Security.Cryptography;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace YFRemote.Server.Services;

// Die CA als iOS-Konfigurationsprofil: Safari bietet es direkt zur Installation an, mit Namen und
// Beschreibung statt einer nackten .crt-Datei, die manche iOS-Versionen als ungueltig ablehnen.
// Die UUIDs haengen am Zertifikat, damit erneutes Laden das Profil ersetzt statt ein zweites
// anzulegen. Vertrauen muss der Nutzer danach trotzdem von Hand einschalten - das verlangt iOS.
public static class AppleConfigurationProfile
{
    public const string ContentType = "application/x-apple-aspen-config";

    public static byte[] Create(byte[] authorityCertificate)
    {
        var hash = SHA256.HashData(authorityCertificate);
        var profileUuid = new Guid(hash.AsSpan(0, 16)).ToString().ToUpperInvariant();
        var payloadUuid = new Guid(hash.AsSpan(16, 16)).ToString().ToUpperInvariant();

        var certificatePayload = Dict(
            ("PayloadCertificateFileName", String("YFRemote-CA.crt")),
            ("PayloadContent", new XElement("data", Convert.ToBase64String(authorityCertificate))),
            ("PayloadDescription", String("Zertifizierungsstelle des YFRemote-PCs")),
            ("PayloadDisplayName", String("YFRemote-Zertifizierungsstelle")),
            ("PayloadIdentifier", String($"local.yfremote.ca.{payloadUuid}")),
            ("PayloadType", String("com.apple.security.root")),
            ("PayloadUUID", String(payloadUuid)),
            ("PayloadVersion", new XElement("integer", 1)));

        var profile = Dict(
            ("PayloadContent", new XElement("array", certificatePayload)),
            ("PayloadDescription", String("Damit dieses Gerät dem YFRemote-PC über HTTPS vertraut.")),
            ("PayloadDisplayName", String("YFRemote")),
            ("PayloadIdentifier", String($"local.yfremote.profile.{profileUuid}")),
            ("PayloadRemovalDisallowed", new XElement("false")),
            ("PayloadType", String("Configuration")),
            ("PayloadUUID", String(profileUuid)),
            ("PayloadVersion", new XElement("integer", 1)));

        var document = new XDocument(
            new XDocumentType(
                "plist",
                "-//Apple//DTD PLIST 1.0//EN",
                "http://www.apple.com/DTDs/PropertyList-1.0.dtd",
                null),
            new XElement("plist", new XAttribute("version", "1.0"), profile));

        using var stream = new MemoryStream();
        using (var writer = XmlWriter.Create(
                   stream,
                   new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = true }))
        {
            document.Save(writer);
        }

        return stream.ToArray();
    }

    private static XElement String(string value) => new("string", value);

    private static XElement Dict(params (string Key, XElement Value)[] entries) =>
        new("dict", entries.SelectMany(entry => new[] { new XElement("key", entry.Key), entry.Value }));
}
