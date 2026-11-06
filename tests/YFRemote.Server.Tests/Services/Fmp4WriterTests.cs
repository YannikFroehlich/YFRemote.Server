using System.Buffers.Binary;
using System.Text;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class Fmp4WriterTests
{
    private static readonly byte[] Sps = [0x67, 0x4D, 0x00, 0x28, 0xAA, 0xBB];
    private static readonly byte[] Pps = [0x68, 0xCE, 0x3C, 0x80];
    private static readonly byte[] Idr = [0x65, 0x88, 0x84, 0x00, 0x10];
    private static readonly byte[] Slice = [0x41, 0x9A, 0x02];

    [TestMethod]
    public void WriteFrame_WaitsForKeyframeThenWritesInitAndOneFragmentPerFrame()
    {
        var writer = new Fmp4Writer(1280, 720, 60000, 1000);

        Assert.IsNull(writer.WriteFrame(AnnexB(Slice)));

        var first = writer.WriteFrame(AnnexB([0x09, 0xF0], Sps, Pps, Idr))!;
        Assert.AreEqual("avc1.4d0028", writer.Codec);
        CollectionAssert.AreEqual(new[] { "ftyp", "moov", "moof", "mdat" }, TopLevelBoxes(first).Select(box => box.Type).ToArray());
        CollectionAssert.AreEqual(LengthPrefixed(Idr), SampleData(first));
        Assert.AreEqual(0x02000000u, SampleFlags(first));
        Assert.AreEqual(0UL, DecodeTime(first));

        var second = writer.WriteFrame(AnnexB(Slice))!;
        CollectionAssert.AreEqual(new[] { "moof", "mdat" }, TopLevelBoxes(second).Select(box => box.Type).ToArray());
        CollectionAssert.AreEqual(LengthPrefixed(Slice), SampleData(second));
        Assert.AreEqual(0x01010000u, SampleFlags(second));
        Assert.AreEqual(1000UL, DecodeTime(second));
    }

    [TestMethod]
    public void SplitNalUnits_HandlesThreeAndFourByteStartCodes()
    {
        byte[] data = [0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x68, 3, 0, 0, 0, 1, 0x65, 4];

        var units = Fmp4Writer.SplitNalUnits(data).Select(unit => data.AsSpan(unit.Start, unit.Length).ToArray()).ToArray();

        Assert.HasCount(3, units);
        CollectionAssert.AreEqual(new byte[] { 0x67, 1, 2 }, units[0]);
        CollectionAssert.AreEqual(new byte[] { 0x68, 3 }, units[1]);
        CollectionAssert.AreEqual(new byte[] { 0x65, 4 }, units[2]);
    }

    private static byte[] AnnexB(params byte[][] units) =>
        units.SelectMany(unit => new byte[] { 0, 0, 0, 1 }.Concat(unit)).ToArray();

    private static byte[] LengthPrefixed(byte[] unit)
    {
        var result = new byte[unit.Length + 4];
        BinaryPrimitives.WriteInt32BigEndian(result, unit.Length);
        unit.CopyTo(result, 4);
        return result;
    }

    private static List<(string Type, int Start, int Length)> TopLevelBoxes(byte[] data)
    {
        var boxes = new List<(string, int, int)>();
        for (var position = 0; position < data.Length;)
        {
            var size = BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(position));
            Assert.IsGreaterThanOrEqualTo(8, size);
            boxes.Add((Encoding.ASCII.GetString(data, position + 4, 4), position, size));
            position += size;
        }

        return boxes;
    }

    // Folgt dem data_offset des trun, wie es der Browser tut, statt einfach den mdat zu lesen.
    private static byte[] SampleData(byte[] data)
    {
        var moof = TopLevelBoxes(data).Single(box => box.Type == "moof");
        var trun = Find(data, moof, "trun");
        var dataOffset = BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(trun + 12));
        var size = BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(trun + 20));
        return data.AsSpan(moof.Start + dataOffset, size).ToArray();
    }

    private static uint SampleFlags(byte[] data)
    {
        var trun = Find(data, TopLevelBoxes(data).Single(box => box.Type == "moof"), "trun");
        return BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(trun + 24));
    }

    private static ulong DecodeTime(byte[] data)
    {
        var tfdt = Find(data, TopLevelBoxes(data).Single(box => box.Type == "moof"), "tfdt");
        return BinaryPrimitives.ReadUInt64BigEndian(data.AsSpan(tfdt + 8));
    }

    private static int Find(byte[] data, (string Type, int Start, int Length) box, string type) =>
        box.Start + data.AsSpan(box.Start, box.Length).IndexOf(Encoding.ASCII.GetBytes(type));
}
