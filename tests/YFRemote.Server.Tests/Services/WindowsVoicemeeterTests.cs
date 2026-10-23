using YFRemote.Server.Configuration;
using YFRemote.Server.Models;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class WindowsVoicemeeterTests
{
    [TestMethod]
    [DataRow("VB-Audio Voicemeeter VAIO", 1, 2)]
    [DataRow("VB-Audio Voicemeeter VAIO", 2, 3)]
    [DataRow("VB-Audio Voicemeeter VAIO", 3, 5)]
    [DataRow("VB-Audio Voicemeeter AUX VAIO", 2, 4)]
    [DataRow("VB-Audio Voicemeeter AUX VAIO", 3, 6)]
    [DataRow("VB-Audio Voicemeeter VAIO3", 3, 7)]
    [DataRow("VB-Audio Voicemeeter AUX VAIO", 1, null)]
    [DataRow("VB-Audio Voicemeeter VAIO", 0, null)]
    [DataRow("Realtek(R) Audio", 2, null)]
    public void StripFor_MapsPlaybackDeviceToVoicemeeterInput(string deviceInterfaceName, int voicemeeterType, int? expected)
    {
        Assert.AreEqual(expected, WindowsVoicemeeter.StripFor(deviceInterfaceName, voicemeeterType));
    }

    [TestMethod]
    [DataRow(-60f, 0)]
    [DataRow(-80f, 0)]
    [DataRow(-30f, 50)]
    [DataRow(0f, 100)]
    [DataRow(6f, 100)]
    public void GainToPercent_FollowsVoicemeeterFader(float gain, int expected)
    {
        Assert.AreEqual(expected, WindowsVoicemeeter.GainToPercent(gain));
    }

    [TestMethod]
    public void PercentToGain_RoundTrips()
    {
        for (var percent = 0; percent <= 100; percent++)
        {
            Assert.AreEqual(percent, WindowsVoicemeeter.GainToPercent(WindowsVoicemeeter.PercentToGain(percent)));
        }
    }

    [TestMethod]
    public void ChannelFor_NonVoicemeeterDevice_ReturnsNull()
    {
        using var voicemeeter = new WindowsVoicemeeter(new VoicemeeterOptions());

        Assert.IsNull(voicemeeter.ChannelFor("Realtek(R) Audio"));
        Assert.IsNull(voicemeeter.ChannelFor(null));
    }

    [TestMethod]
    public void Message_EqualContent_IsEqual()
    {
        VoicemeeterMessage Create() => new(
            [new VoicemeeterChannel("Strip[3]", "Voicemeeter VAIO", true, -6.5)],
            ["A1", "B1"]);

        Assert.AreEqual(Create(), Create());
        Assert.AreNotEqual(Create(), new VoicemeeterMessage(null, null));
    }
}
