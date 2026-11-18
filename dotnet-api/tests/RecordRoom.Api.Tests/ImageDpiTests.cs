using RecordRoom.Api.Application.Services;

namespace RecordRoom.Api.Tests;

/// <summary>
/// The DPI reader behind the upload quality gate (§3.2). Headers are built
/// byte-by-byte so the parser is tested against exactly what scanners write:
/// JFIF APP0 density, EXIF XResolution, PNG pHYs, and the formats that carry
/// no DPI at all.
/// </summary>
public class ImageDpiTests
{
    private static byte[] Hex(string value) =>
        Convert.FromHexString(value.Replace(" ", "").Replace("\n", ""));

    /// <summary>SOI + APP0/JFIF with the given units and density, then EOI.</summary>
    private static byte[] Jfif(byte units, ushort xDensity)
    {
        var head = new List<byte> { 0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10 };
        head.AddRange("JFIF\0"u8);
        head.AddRange([0x01, 0x02, units]);
        head.AddRange([(byte)(xDensity >> 8), (byte)(xDensity & 0xFF), 0, 0]); // X, Y
        head.AddRange([0, 0]); // no thumbnail
        head.AddRange([0xFF, 0xD9]);
        return [.. head];
    }

    [Fact]
    public void Reads_jfif_density_in_inches()
    {
        var dpi = ImageDpi.Read(Jfif(1, 300), "image/jpeg");
        Assert.Equal(300, dpi);
    }

    [Fact]
    public void Converts_jfif_density_from_centimetres()
    {
        // 118 dots/cm is the 300 DPI setting some scanners write.
        var dpi = ImageDpi.Read(Jfif(2, 118), "image/jpeg");
        Assert.Equal(300, dpi);
    }

    [Fact]
    public void Aspect_ratio_only_jfif_reads_as_unknown()
    {
        // units=0 means "no absolute density" — the gate must skip, not reject.
        Assert.Null(ImageDpi.Read(Jfif(0, 300), "image/jpeg"));
    }

    [Fact]
    public void Reads_exif_xresolution_in_inches()
    {
        // SOI + APP1/Exif: "Exif\0\0", TIFF (II, 42, IFD at 8), 2 entries:
        // XResolution (rational 200/1 at offset 34) and ResolutionUnit=2 (inch).
        // Segment = 6 (Exif\0\0) + 8 (TIFF) + 2 (count) + 24 (entries) + 4 (next
        // IFD) + 8 (rational) = 52 bytes, so the length field is 54.
        var bytes = new List<byte> { 0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x36 };
        bytes.AddRange("Exif\0\0"u8);
        bytes.AddRange([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00]); // TIFF header
        bytes.AddRange([0x02, 0x00]); // 2 IFD entries
        bytes.AddRange([0x1A, 0x01, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x26, 0x00, 0x00, 0x00]); // XResolution @ 38
        bytes.AddRange([0x28, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]); // unit=inch
        bytes.AddRange([0x00, 0x00, 0x00, 0x00]); // next IFD = 0
        bytes.AddRange([0xC8, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]); // 200/1
        var dpi = ImageDpi.Read([.. bytes], "image/jpeg");
        Assert.Equal(200, dpi);
    }

    /// <summary>PNG signature + IHDR + a pHYs chunk with the given pixels-per-metre and unit.</summary>
    private static byte[] Png(uint pixelsPerMetre, byte unit, bool withPhys = true)
    {
        var bytes = new List<byte>(Hex("89504E470D0A1A0A"));
        bytes.AddRange(Hex("0000000D49484452")); // IHDR length + type
        bytes.AddRange(new byte[13]); // zeroed dims/bit depth/colour type
        bytes.AddRange(new byte[4]); // CRC (not parsed)
        if (withPhys)
        {
            bytes.AddRange(Hex("0000000970485973")); // pHYs length + type
            var ppm = BitConverter.GetBytes(pixelsPerMetre); // little-endian on build host
            if (BitConverter.IsLittleEndian) ppm = ppm.Reverse().ToArray();
            bytes.AddRange(ppm); // X
            bytes.AddRange(ppm); // Y
            bytes.Add(unit);
            bytes.AddRange(new byte[4]); // CRC
        }
        else
        {
            bytes.AddRange(Hex("0000000D49444154")); // IDAT first: no pHYs anywhere
            bytes.AddRange(new byte[13]);
        }
        return [.. bytes];
    }

    [Fact]
    public void Reads_png_phys_in_metres()
    {
        // 11811 px/m is the canonical 300 DPI setting.
        var dpi = ImageDpi.Read(Png(11811, 1), "image/png");
        Assert.Equal(300, dpi);
    }

    [Fact]
    public void A_png_without_phys_reads_as_unknown()
    {
        Assert.Null(ImageDpi.Read(Png(0, 0, withPhys: false), "image/png"));
    }

    [Fact]
    public void A_png_with_aspect_ratio_only_phys_reads_as_unknown()
    {
        Assert.Null(ImageDpi.Read(Png(11811, 0), "image/png"));
    }

    [Theory]
    [InlineData("image/gif")]
    [InlineData("application/pdf")]
    public void Formats_without_density_information_read_as_unknown(string contentType)
    {
        // GIF and PDF carry no scanner DPI: the gate skips them, it does not reject.
        Assert.Null(ImageDpi.Read(new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 }, contentType));
    }

    [Fact]
    public void A_wrong_signature_does_not_crash_the_parser()
    {
        Assert.Null(ImageDpi.Read(new byte[] { 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07 }, "image/jpeg"));
        Assert.Null(ImageDpi.Read([], "image/jpeg"));
    }

    [Fact]
    public void Jfip_without_app0_reads_as_unknown()
    {
        // SOI + an APP2 marker with junk, then EOI: nothing parseable.
        var bytes = new List<byte> { 0xFF, 0xD8, 0xFF, 0xE2, 0x00, 0x04, 0x99, 0x99, 0xFF, 0xD9 };
        Assert.Null(ImageDpi.Read([.. bytes], "image/jpeg"));
    }
}
