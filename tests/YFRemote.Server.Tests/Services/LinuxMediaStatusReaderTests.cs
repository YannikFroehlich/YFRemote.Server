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
    public void ParseSinks_ReadsNameDescriptionAndDefault()
    {
        const string output = """
            Sink #47
            	State: RUNNING
            	Name: alsa_output.usb-Headset-00.analog-stereo
            	Description: USB Headset Analog Stereo
            	Driver: PipeWire
            	Properties:
            		node.name = "alsa_output.usb-Headset-00.analog-stereo"
            Sink #52
            	State: SUSPENDED
            	Name: alsa_output.pci-0000_00_1f.3.analog-stereo
            	Description: Built-in Audio Analog Stereo
            """;

        CollectionAssert.AreEqual(
            new[]
            {
                new AudioOutput("alsa_output.pci-0000_00_1f.3.analog-stereo", "Built-in Audio Analog Stereo", false),
                new AudioOutput("alsa_output.usb-Headset-00.analog-stereo", "USB Headset Analog Stereo", true)
            },
            LinuxMediaStatusReader.ParseSinks(output, "alsa_output.usb-Headset-00.analog-stereo").ToArray());
        Assert.AreEqual(0, LinuxMediaStatusReader.ParseSinks(null, null).Count);
    }

    [TestMethod]
    public void ParseNowPlaying_SplitsStatusTimelineCoverTitleAndArtist()
    {
        Assert.AreEqual(
            (new MediaStatusMessage(null, false, "Song", "Band", true, 83, 215, CanSeek: true),
                "https://i.scdn.co/image/ab67616d"),
            LinuxMediaStatusReader.ParseNowPlaying(
                "Playing\t83500000\t215000000\thttps://i.scdn.co/image/ab67616d\tSong\tBand\n"));
        // Livestream ohne Cover: keine Laenge, also auch keine Zeitleiste
        Assert.AreEqual(
            (new MediaStatusMessage(null, false, "Video", null, false), (string?)null),
            LinuxMediaStatusReader.ParseNowPlaying("Paused\t12000000\t\t\tVideo\t\n"));
        // playerctl ohne laufenden Player
        Assert.AreEqual(
            (new MediaStatusMessage(null, false, null, null, false), (string?)null),
            LinuxMediaStatusReader.ParseNowPlaying(null));
    }

    [TestMethod]
    public async Task ReadCoverAsync_ReadsLocalPngAndJpegOnly()
    {
        var directory = Path.Combine(Path.GetTempPath(), "YFRemote.Server.Tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var png = Path.Combine(directory, "cover.png");
            byte[] pngBytes = [0x89, 0x50, 0x4E, 0x47, 1, 2, 3];
            await File.WriteAllBytesAsync(png, pngBytes);
            var text = Path.Combine(directory, "cover.txt");
            await File.WriteAllTextAsync(text, "kein Bild");
            var tooLarge = Path.Combine(directory, "large.png");
            await File.WriteAllBytesAsync(tooLarge, [.. pngBytes, .. new byte[2 * 1024 * 1024]]);

            var cover = await LinuxMediaStatusReader.ReadCoverAsync(new Uri(png).AbsoluteUri);

            Assert.IsNotNull(cover);
            Assert.AreEqual("image/png", cover.ContentType);
            CollectionAssert.AreEqual(pngBytes, cover.Data);
            Assert.AreEqual(16, cover.Id.Length);
            Assert.IsNull(await LinuxMediaStatusReader.ReadCoverAsync(new Uri(text).AbsoluteUri));
            Assert.IsNull(await LinuxMediaStatusReader.ReadCoverAsync(new Uri(tooLarge).AbsoluteUri));
            Assert.IsNull(await LinuxMediaStatusReader.ReadCoverAsync(new Uri(Path.Combine(directory, "missing.png")).AbsoluteUri));
            Assert.IsNull(await LinuxMediaStatusReader.ReadCoverAsync("data:image/png;base64,iVBORw0KGgo="));
            Assert.IsNull(await LinuxMediaStatusReader.ReadCoverAsync("kein uri"));
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }
}
