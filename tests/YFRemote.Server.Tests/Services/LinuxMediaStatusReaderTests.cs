using YFRemote.Server.Models;
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
    public void ParseSinkInputs_ReadsIdNameVolumeAndMute()
    {
        const string output = """
            Sink Input #42
            	Driver: protocol-native.c
            	Mute: no
            	Volume: front-left: 45875 /  70% / -9.29 dB,   front-right: 45875 /  70% / -9.29 dB
            	        balance 0.00
            	Properties:
            		media.name = "Playback"
            		application.name = "Spotify"
            Sink Input #57
            	Mute: yes
            	Volume: mono: 98304 / 150% / 10.57 dB
            	Properties:
            		media.name = "AudioStream"
            Sink Input #12
            	Mute: no
            	Volume: front-left: 65536 / 100% / 0.00 dB
            	Properties:
            		application.name = "Firefox"
            """;

        CollectionAssert.AreEqual(
            new[]
            {
                new AppVolume("12", "Firefox", 100, false),
                new AppVolume("42", "Spotify", 70, false),
                new AppVolume("57", "Stream 57", 100, true)
            },
            LinuxMediaStatusReader.ParseSinkInputs(output).ToArray());
        Assert.AreEqual(0, LinuxMediaStatusReader.ParseSinkInputs(null).Count);
    }

    [TestMethod]
    public void ParseNowPlaying_SplitsStatusTimelineTitleAndArtist()
    {
        Assert.AreEqual(
            new MediaStatusMessage(null, false, "Song", "Band", true, 83, 215, CanSeek: true),
            LinuxMediaStatusReader.ParseNowPlaying("Playing\t83500000\t215000000\tSong\tBand\n"));
        // Livestream: keine Laenge, also auch keine Zeitleiste
        Assert.AreEqual(
            new MediaStatusMessage(null, false, "Video", null, false),
            LinuxMediaStatusReader.ParseNowPlaying("Paused\t12000000\t\tVideo\t\n"));
        // playerctl ohne laufenden Player
        Assert.AreEqual(
            new MediaStatusMessage(null, false, null, null, false),
            LinuxMediaStatusReader.ParseNowPlaying(null));
    }
}
