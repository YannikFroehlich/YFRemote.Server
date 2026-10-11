using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

// Deckt nur das Auswerten der Ausgaben von pactl und playerctl ab: Die Werkzeuge selbst brauchen
// eine echte Linux-Sitzung - dafuer siehe AGENTS.md "Linux support".
[TestClass]
public sealed class LinuxMediaStatusReaderTests
{
    [TestMethod]
    public void ParseVolume_TakesTheFirstChannelAndCapsAt100()
    {
        Assert.AreEqual(45, LinuxMediaStatusReader.ParseVolume(
            "Volume: front-left: 29491 /  45% / -20.81 dB,   front-right: 32768 /  50% / -18.06 dB\n        balance -0.10\n"));
        Assert.AreEqual(100, LinuxMediaStatusReader.ParseVolume("Volume: mono: 98304 / 150% / 10.57 dB\n"));
        Assert.IsNull(LinuxMediaStatusReader.ParseVolume(null));
    }

    [TestMethod]
    public void ParseMuted_ReadsPactlOutput()
    {
        Assert.IsTrue(LinuxMediaStatusReader.ParseMuted("Mute: yes\n"));
        Assert.IsFalse(LinuxMediaStatusReader.ParseMuted("Mute: no\n"));
        Assert.IsFalse(LinuxMediaStatusReader.ParseMuted(null));
    }

    [TestMethod]
    public void ParseNowPlaying_SplitsStatusTitleAndArtist()
    {
        Assert.AreEqual(
            ("Song", "Band", true),
            LinuxMediaStatusReader.ParseNowPlaying("Playing\tSong\tBand\n"));
        Assert.AreEqual(
            ("Video", (string?)null, false),
            LinuxMediaStatusReader.ParseNowPlaying("Paused\tVideo\t\n"));
        // playerctl ohne laufenden Player
        Assert.AreEqual(
            ((string?)null, (string?)null, false),
            LinuxMediaStatusReader.ParseNowPlaying(null));
    }
}
