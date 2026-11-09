using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class WindowsAudioCaptureTests
{
    private const float Half = 0.7071f;
    private const float Delta = 0.0001f;

    [TestMethod]
    public void Downmix_Surround51_KeepsCenterAndSurroundAndDropsLfe()
    {
        var gains = WindowsAudioCapture.BuildDownmix(6, 0x3F);
        float[] frame = [0.1f, 0.2f, 0.4f, 0.9f, 0.2f, 0.3f]; // FL FR C LFE BL BR

        Assert.AreEqual(0.1f + (0.4f * Half) + (0.2f * Half), WindowsAudioCapture.Mix<float>(frame, gains, 0), Delta);
        Assert.AreEqual(0.2f + (0.4f * Half) + (0.3f * Half), WindowsAudioCapture.Mix<float>(frame, gains, 1), Delta);
    }

    [TestMethod]
    public void Downmix_Surround71_IncludesSideChannels()
    {
        var gains = WindowsAudioCapture.BuildDownmix(8, 0x63F);
        float[] frame = [0f, 0f, 0f, 0f, 0f, 0f, 0.5f, 0.25f]; // nur SL SR

        Assert.AreEqual(0.5f * Half, WindowsAudioCapture.Mix<float>(frame, gains, 0), Delta);
        Assert.AreEqual(0.25f * Half, WindowsAudioCapture.Mix<float>(frame, gains, 1), Delta);
    }

    [TestMethod]
    public void Downmix_Pcm16_UsesSampleRange()
    {
        var gains = WindowsAudioCapture.BuildDownmix(6, 0x3F);
        short[] frame = [1000, -1000, 2000, 30000, 0, 0];

        Assert.AreEqual(1000f + (2000f * Half), WindowsAudioCapture.Mix<short>(frame, gains, 0), 0.5f);
        Assert.AreEqual(-1000f + (2000f * Half), WindowsAudioCapture.Mix<short>(frame, gains, 1), 0.5f);
    }

    [TestMethod]
    public void Downmix_WithoutUsableMask_TakesFirstTwoChannels()
    {
        foreach (var mask in new[] { 0, 0x4 })
        {
            var gains = WindowsAudioCapture.BuildDownmix(6, mask);
            float[] frame = [0.1f, 0.2f, 0.9f, 0.9f, 0.9f, 0.9f];

            Assert.AreEqual(0.1f, WindowsAudioCapture.Mix<float>(frame, gains, 0), Delta);
            Assert.AreEqual(0.2f, WindowsAudioCapture.Mix<float>(frame, gains, 1), Delta);
        }
    }

    [TestMethod]
    public void Downmix_MaskWithMoreSpeakersThanChannels_StaysInBounds()
    {
        var gains = WindowsAudioCapture.BuildDownmix(3, 0x3F);

        Assert.HasCount(3, gains);
        Assert.AreEqual((Half, Half), gains[2]);
    }
}
