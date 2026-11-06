using System.Buffers.Binary;
using System.Text;

namespace YFRemote.Server.Services;

// Packt H.264 (Annex B, wie der Media-Foundation-Encoder es liefert) in fragmentiertes MP4, das
// der Browser per MediaSource abspielt: einmal ftyp+moov, danach je Bild ein moof+mdat, damit
// jedes Bild sofort beim Geraet ist. Die Zeitachse laeuft lueckenlos in festen Schritten statt nach
// Uhrzeit - eine Luecke im Puffer liesse den Browser stehen bleiben; kommen Bilder seltener, wartet
// das Video einfach auf das naechste.
public sealed class Fmp4Writer(int width, int height, int timescale, int frameDuration)
{
    private const int TrackId = 1;
    private byte[]? sps;
    private byte[]? pps;
    private bool initWritten;
    private uint sequence;
    private ulong decodeTime;

    // Codec-Angabe fuer MediaSource.addSourceBuffer, sobald das erste SPS gesehen wurde.
    public string? Codec => sps is null ? null : $"avc1.{sps[1]:x2}{sps[2]:x2}{sps[3]:x2}";

    // Liefert die zu sendenden Bytes; null, solange noch kein Schluesselbild mit SPS/PPS kam.
    public byte[]? WriteFrame(ReadOnlySpan<byte> annexB)
    {
        var sample = new MemoryStream();
        var keyframe = false;
        foreach (var (start, length) in SplitNalUnits(annexB))
        {
            var nal = annexB.Slice(start, length);
            switch (nal[0] & 0x1F)
            {
                case 7:
                    sps = nal.ToArray();
                    continue;
                case 8:
                    pps = nal.ToArray();
                    continue;
                case 9:
                    continue;
                case 5:
                    keyframe = true;
                    break;
            }

            U32(sample, (uint)nal.Length);
            sample.Write(nal);
        }

        if (!initWritten && (!keyframe || sps is null || pps is null))
        {
            return null;
        }

        var output = new MemoryStream();
        if (!initWritten)
        {
            WriteInit(output);
            initWritten = true;
        }

        WriteFragment(output, sample.ToArray(), keyframe);
        return output.ToArray();
    }

    private void WriteInit(MemoryStream output)
    {
        Box(output, "ftyp", body =>
        {
            body.Write("isom"u8);
            U32(body, 0x200);
            body.Write("isomiso6avc1mp41"u8);
        });
        Box(output, "moov", moov =>
        {
            FullBox(moov, "mvhd", 0, 0, body =>
            {
                U32(body, 0);
                U32(body, 0);
                U32(body, (uint)timescale);
                U32(body, 0);
                U32(body, 0x00010000);
                U16(body, 0x0100);
                body.Write(new byte[10]);
                Matrix(body);
                body.Write(new byte[24]);
                U32(body, TrackId + 1);
            });
            Box(moov, "trak", trak =>
            {
                FullBox(trak, "tkhd", 0, 3, body =>
                {
                    U32(body, 0);
                    U32(body, 0);
                    U32(body, TrackId);
                    U32(body, 0);
                    U32(body, 0);
                    body.Write(new byte[8]);
                    U16(body, 0);
                    U16(body, 0);
                    U16(body, 0);
                    U16(body, 0);
                    Matrix(body);
                    U32(body, (uint)width << 16);
                    U32(body, (uint)height << 16);
                });
                Box(trak, "mdia", mdia =>
                {
                    FullBox(mdia, "mdhd", 0, 0, body =>
                    {
                        U32(body, 0);
                        U32(body, 0);
                        U32(body, (uint)timescale);
                        U32(body, 0);
                        U16(body, 0x55C4);
                        U16(body, 0);
                    });
                    FullBox(mdia, "hdlr", 0, 0, body =>
                    {
                        U32(body, 0);
                        body.Write("vide"u8);
                        body.Write(new byte[12]);
                        body.Write("YFRemote\0"u8);
                    });
                    Box(mdia, "minf", minf =>
                    {
                        FullBox(minf, "vmhd", 0, 1, body => body.Write(new byte[8]));
                        Box(minf, "dinf", dinf => FullBox(dinf, "dref", 0, 0, body =>
                        {
                            U32(body, 1);
                            FullBox(body, "url ", 0, 1, _ => { });
                        }));
                        Box(minf, "stbl", stbl =>
                        {
                            FullBox(stbl, "stsd", 0, 0, body =>
                            {
                                U32(body, 1);
                                Box(body, "avc1", WriteAvc1);
                            });
                            FullBox(stbl, "stts", 0, 0, body => U32(body, 0));
                            FullBox(stbl, "stsc", 0, 0, body => U32(body, 0));
                            FullBox(stbl, "stsz", 0, 0, body =>
                            {
                                U32(body, 0);
                                U32(body, 0);
                            });
                            FullBox(stbl, "stco", 0, 0, body => U32(body, 0));
                        });
                    });
                });
            });
            Box(moov, "mvex", mvex => FullBox(mvex, "trex", 0, 0, body =>
            {
                U32(body, TrackId);
                U32(body, 1);
                U32(body, 0);
                U32(body, 0);
                U32(body, 0);
            }));
        });
    }

    private void WriteAvc1(MemoryStream body)
    {
        body.Write(new byte[6]);
        U16(body, 1);
        body.Write(new byte[16]);
        U16(body, (ushort)width);
        U16(body, (ushort)height);
        U32(body, 0x00480000);
        U32(body, 0x00480000);
        U32(body, 0);
        U16(body, 1);
        body.Write(new byte[32]);
        U16(body, 0x0018);
        U16(body, 0xFFFF);
        Box(body, "avcC", avcC =>
        {
            avcC.WriteByte(1);
            avcC.WriteByte(sps![1]);
            avcC.WriteByte(sps[2]);
            avcC.WriteByte(sps[3]);
            avcC.WriteByte(0xFF);
            avcC.WriteByte(0xE1);
            U16(avcC, (ushort)sps.Length);
            avcC.Write(sps);
            avcC.WriteByte(1);
            U16(avcC, (ushort)pps!.Length);
            avcC.Write(pps);
            // High-Profile verlangt die Chroma-/Bittiefe-Angaben; 4:2:0 mit 8 Bit.
            if (sps[1] is 100 or 110 or 122 or 144)
            {
                avcC.Write([0xFD, 0xF8, 0xF8, 0x00]);
            }
        });
    }

    private void WriteFragment(MemoryStream output, byte[] sample, bool keyframe)
    {
        var moofStart = output.Position;
        Box(output, "moof", moof =>
        {
            FullBox(moof, "mfhd", 0, 0, body => U32(body, ++sequence));
            Box(moof, "traf", traf =>
            {
                // default-base-is-moof: data_offset zaehlt ab dem Anfang dieses moof.
                FullBox(traf, "tfhd", 0, 0x020000, body => U32(body, TrackId));
                FullBox(traf, "tfdt", 1, 0, body => U64(body, decodeTime));
                FullBox(traf, "trun", 0, 0x000701, body =>
                {
                    U32(body, 1);
                    U32(body, 0);
                    U32(body, (uint)frameDuration);
                    U32(body, (uint)sample.Length);
                    U32(body, keyframe ? 0x02000000u : 0x01010000u);
                });
            });
        });

        var moofLength = output.Position - moofStart;
        Box(output, "mdat", body => body.Write(sample));
        decodeTime += (ulong)frameDuration;
        PatchDataOffset(output, moofStart, moofLength);
    }

    // Die Groesse des moof steht erst fest, wenn er geschrieben ist; der data_offset im trun
    // (hinter Typ, Version/Flags und Anzahl) zeigt auf den Inhalt des folgenden mdat.
    private static void PatchDataOffset(MemoryStream output, long moofStart, long moofLength)
    {
        var moof = output.GetBuffer().AsSpan((int)moofStart, (int)moofLength);
        var trun = moof.IndexOf("trun"u8);
        BinaryPrimitives.WriteInt32BigEndian(moof[(trun + 12)..], (int)moofLength + 8);
    }

    internal static IEnumerable<(int Start, int Length)> SplitNalUnits(ReadOnlySpan<byte> data)
    {
        var units = new List<(int, int)>();
        var start = -1;
        for (var index = 0; index + 2 < data.Length; index++)
        {
            if (data[index] != 0 || data[index + 1] != 0 || data[index + 2] != 1)
            {
                continue;
            }

            if (start >= 0)
            {
                units.Add((start, TrimTrailingZeros(data, start, index)));
            }

            start = index + 3;
            index += 2;
        }

        if (start >= 0 && start < data.Length)
        {
            units.Add((start, data.Length - start));
        }

        return units.Where(unit => unit.Item2 > 0);
    }

    // Der Nullbyte-Vorspann eines 4-Byte-Startcodes gehoert nicht zur vorigen NAL-Einheit.
    private static int TrimTrailingZeros(ReadOnlySpan<byte> data, int start, int end)
    {
        while (end > start && data[end - 1] == 0)
        {
            end--;
        }

        return end - start;
    }

    private static void Box(MemoryStream output, string type, Action<MemoryStream> writeBody)
    {
        var body = new MemoryStream();
        writeBody(body);
        U32(output, (uint)(body.Length + 8));
        output.Write(Encoding.ASCII.GetBytes(type));
        body.Position = 0;
        body.CopyTo(output);
    }

    private static void FullBox(MemoryStream output, string type, byte version, uint flags, Action<MemoryStream> writeBody) =>
        Box(output, type, body =>
        {
            U32(body, ((uint)version << 24) | flags);
            writeBody(body);
        });

    private static void Matrix(MemoryStream body)
    {
        foreach (var value in new uint[] { 0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000 })
        {
            U32(body, value);
        }
    }

    private static void U16(MemoryStream output, ushort value)
    {
        Span<byte> bytes = stackalloc byte[2];
        BinaryPrimitives.WriteUInt16BigEndian(bytes, value);
        output.Write(bytes);
    }

    private static void U32(MemoryStream output, uint value)
    {
        Span<byte> bytes = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(bytes, value);
        output.Write(bytes);
    }

    private static void U64(MemoryStream output, ulong value)
    {
        Span<byte> bytes = stackalloc byte[8];
        BinaryPrimitives.WriteUInt64BigEndian(bytes, value);
        output.Write(bytes);
    }
}
