namespace RecordRoom.Api.Application.Services;

/// <summary>
/// Reads the physical resolution encoded in an image header (§3.2 quality
/// gate). JPEG carries density in JFIF APP0 or an EXIF APP1 block; PNG carries
/// it in a pHYs chunk. GIF and PDF have no meaningful DPI and read as null, so
/// the gate skips them rather than rejecting good scans.
///
/// Pure logic on purpose: the parsing is fiddly enough to deserve its own unit
/// tests without a filesystem in the way.
/// </summary>
public static class ImageDpi
{
    /// <summary>Reads DPI from the first bytes of an image. Null when unknown.</summary>
    public static int? Read(ReadOnlySpan<byte> head, string contentType)
    {
        if (head.Length < 8) return null;
        return contentType switch
        {
            "image/jpeg" => ReadJpeg(head),
            "image/png" => ReadPng(head),
            _ => null,
        };
    }

    private static int? ReadJpeg(ReadOnlySpan<byte> head)
    {
        if (head[0] != 0xFF || head[1] != 0xD8) return null;

        var i = 2;
        while (i + 4 <= head.Length)
        {
            if (head[i] != 0xFF) { i++; continue; }
            var marker = head[i + 1];
            // Standalone markers carry no length payload.
            if (marker is 0xD8 or 0x01 or (>= 0xD0 and <= 0xD7))
            {
                i += 2;
                continue;
            }
            if (i + 4 > head.Length) break;
            var length = (head[i + 2] << 8) | head[i + 3];
            if (length < 2) return null;

            if (marker == 0xE0 && length >= 16 && i + 2 + 16 <= head.Length)
            {
                // JFIF APP0: "JFIF\0", version(2), units(1: 1=dpi 2=dpcm), X density(2), Y density(2).
                var segment = head.Slice(i + 4, length - 2);
                if (segment.Length >= 9 && segment[0] == (byte)'J' && segment[1] == (byte)'F'
                    && segment[2] == (byte)'I' && segment[3] == (byte)'F' && segment[4] == 0)
                {
                    var units = segment[7];
                    var x = (segment[8] << 8) | segment[9];
                    if (x > 0)
                    {
                        return units switch
                        {
                            1 => x,
                            2 => (int)Math.Round(x * 2.54), // dots per cm → dots per inch
                            _ => null, // 0 = aspect ratio only
                        };
                    }
                }
            }
            else if (marker == 0xE1 && length > 10 && i + 4 + 6 <= head.Length)
            {
                // EXIF APP1: "Exif\0\0" then a TIFF header. XResolution lives in
                // IFD0 tag 0x011A, ResolutionUnit tag 0x0128 (2 = inch, 3 = cm).
                var exif = ReadExifXResolution(head, i + 4, length - 2);
                if (exif is not null) return exif;
            }

            i += 2 + length;
        }
        return null;
    }

    private static int? ReadExifXResolution(ReadOnlySpan<byte> head, int start, int length)
    {
        var exif = head.Slice(start, Math.Min(length, head.Length - start));
        if (exif.Length < 14) return null;
        if (exif[0] != (byte)'E' || exif[1] != (byte)'x' || exif[2] != (byte)'i' || exif[3] != (byte)'f') return null;

        var tiff = exif.Slice(6);
        var littleEndian = tiff[0] == 0x49 && tiff[1] == 0x49;
        short Short(ReadOnlySpan<byte> b) =>
            littleEndian ? (short)(b[0] | (b[1] << 8)) : (short)((b[0] << 8) | b[1]);
        int Long(ReadOnlySpan<byte> b) =>
            littleEndian
                ? b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)
                : (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];

        var ifdOffset = Long(tiff.Slice(4));
        if (ifdOffset + 2 > tiff.Length) return null;
        var entries = Short(tiff.Slice(ifdOffset));
        var unit = 2; // EXIF default: inches
        int? xResolution = null;

        for (var e = 0; e < entries; e++)
        {
            var entry = ifdOffset + 2 + e * 12;
            if (entry + 12 > tiff.Length) break;
            var tag = Short(tiff.Slice(entry));
            if (tag == 0x011A)
            {
                // RATIONAL: 8 bytes (numerator/denominator), inline when it fits in 4 (it never does).
                var valueOffset = Long(tiff.Slice(entry + 8));
                if (valueOffset + 8 <= tiff.Length)
                {
                    var numerator = Long(tiff.Slice(valueOffset));
                    var denominator = Long(tiff.Slice(valueOffset + 4));
                    if (numerator > 0 && denominator > 0)
                        xResolution = (int)Math.Round((double)numerator / denominator);
                }
            }
            else if (tag == 0x0128)
            {
                unit = Short(tiff.Slice(entry + 8));
            }
        }

        return unit switch
        {
            2 => xResolution,
            3 => xResolution is null ? null : (int)Math.Round(xResolution.Value * 2.54),
            _ => null,
        };
    }

    private static int? ReadPng(ReadOnlySpan<byte> head)
    {
        // Signature is already validated by the caller's magic-byte check.
        var i = 8;
        while (i + 12 <= head.Length)
        {
            var length = (head[i] << 24) | (head[i + 1] << 16) | (head[i + 2] << 8) | head[i + 3];
            var type = head.Slice(i + 4, 4);
            if (type.SequenceEqual("pHYs"u8) && length == 9 && i + 8 + 9 <= head.Length)
            {
                var data = head.Slice(i + 8, 9);
                var pixelsPerMeter = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
                var unit = data[8]; // 1 = metre
                if (unit != 1 || pixelsPerMeter <= 0) return null;
                return (int)Math.Round(pixelsPerMeter * 0.0254);
            }
            // IHDR must come first; stop at the image data.
            if (type.SequenceEqual("IDAT"u8)) return null;
            i += 12 + length;
            if (length < 0) return null;
        }
        return null;
    }
}
