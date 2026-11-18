using Docnet.Core;
using OpenCvSharp;
using RecordRoom.Api.Application;

namespace RecordRoom.Api.Infrastructure.Imaging;

/// <summary>
/// Scan enhancement operations (work plan §3.2). Every operation writes a new
/// processed copy — the original blob is never modified, because archival work
/// must be able to prove what was scanned.
///
/// OpenCvSharp5 for the pixel work; Docnet (PDFium) to rasterize a stored PDF
/// page before an operation is applied to it.
/// </summary>
public interface IScanEnhancer
{
    /// <summary>Supported operation keys, as the API contract spells them.</summary>
    IReadOnlyCollection<string> Operations { get; }

    /// <summary>
    /// Applies one operation and returns the processed image bytes (PNG) plus
    /// the human-readable label stamped on the page row.
    /// </summary>
    Task<Result<(byte[] Bytes, string Label)>> EnhanceAsync(
        byte[] source, string contentType, string operation, int? pageIndex,
        int degrees = 90, CancellationToken ct = default);
}

public sealed class ScanEnhancer : IScanEnhancer
{
    public IReadOnlyCollection<string> Operations { get; } =
        ["rotate", "deskew", "despeckle", "binarize", "crop", "contrast"];

    /// <summary>Rotations the rotate operation accepts, in quarter turns.</summary>
    public static readonly int[] AllowedRotations = [90, 180, 270];

    // A4 at 200 DPI: enough that the rasterized page survives re-encoding.
    private const int RasterWidth = 1654;
    private const int RasterHeight = 2339;

    public async Task<Result<(byte[], string)>> EnhanceAsync(
        byte[] source, string contentType, string operation, int? pageIndex,
        int degrees = 90, CancellationToken ct = default)
    {
        if (!Operations.Contains(operation, StringComparer.OrdinalIgnoreCase))
            return Result<(byte[], string)>.Fail(
                $"Operation must be one of {string.Join(", ", Operations)}.", "operation");

        ct.ThrowIfCancellationRequested();
        await Task.Yield(); // keep the pixel work off the caller's sync context

        using var image = Load(source, contentType, pageIndex ?? 0);
        if (image is null)
            return Result<(byte[], string)>.Fail(
                "The stored scan could not be decoded as an image or a PDF page.", "document");

        if (operation.Equals("rotate", StringComparison.OrdinalIgnoreCase)
            && !AllowedRotations.Contains(degrees))
            return Result<(byte[], string)>.Fail(
                $"Rotation must be one of {string.Join(", ", AllowedRotations)} degrees.", "degrees");

        using var processed = Apply(image, operation, degrees);
        if (processed is null)
            return Result<(byte[], string)>.Fail("This operation cannot run on the stored scan.", "operation");

        Cv2.ImEncode(".png", processed, out var bytes);
        return Result<(byte[], string)>.Ok((bytes, Label(operation)));
    }

    private static string Label(string operation) => operation.ToLowerInvariant() switch
    {
        "rotate" => "rotated",
        "deskew" => "deskewed",
        "despeckle" => "despeckled",
        "binarize" => "binarized",
        "crop" => "cropped",
        "contrast" => "contrast (CLAHE)",
        _ => operation,
    };

    /// <summary>Decodes a stored blob: images directly, PDFs via PDFium rasterization.</summary>
    private Mat? Load(byte[] source, string contentType, int pageIndex)
    {
        if (contentType != "application/pdf")
        {
            var mat = Cv2.ImDecode(source, ImreadModes.Color);
            return mat.Empty() ? null : mat;
        }

        try
        {
            using var docReader = DocLib.Instance.GetDocReader(
                source, new Docnet.Core.Models.PageDimensions(RasterWidth, RasterHeight));
            if (pageIndex < 0 || pageIndex >= docReader.GetPageCount()) pageIndex = 0;
            using var pageReader = docReader.GetPageReader(pageIndex);
            var raw = pageReader.GetImage(); // BGR, 3 bytes per pixel
            var width = pageReader.GetPageWidth();
            var height = pageReader.GetPageHeight();
            // The Mat must own its memory: the reader (and its buffer) is disposed on return.
            var handle = System.Runtime.InteropServices.GCHandle.Alloc(
                raw, System.Runtime.InteropServices.GCHandleType.Pinned);
            try
            {
                using var wrapped = Mat.FromPixelData(
                    height, width, MatType.CV_8UC3, handle.AddrOfPinnedObject());
                return wrapped.Clone();
            }
            finally
            {
                handle.Free();
            }
        }
        catch
        {
            return null;
        }
    }

    private static Mat? Apply(Mat src, string operation, int degrees)
    {
        switch (operation.ToLowerInvariant())
        {
            case "rotate":
                // Rotation by exact quarter turns; the caller validated the degrees.
                return RotateExact(src, degrees);

            case "deskew":
            {
                // Median skew angle from the minimum-area rect of the ink, not
                // the mean: one bold stamp must not drag the whole page.
                var angle = MedianSkewAngle(src);
                if (angle is null || Math.Abs(angle.Value) < 0.5)
                    return src.Clone();

                using var rotated = RotateWithBounds(src, angle.Value);
                return rotated.Clone();
            }

            case "despeckle":
            {
                var denoised = new Mat();
                Cv2.FastNlMeansDenoisingColored(src, denoised);
                return denoised;
            }

            case "binarize":
            {
                using var gray = new Mat();
                Cv2.CvtColor(src, gray, ColorConversionCodes.BGR2GRAY);
                using var binary = new Mat();
                Cv2.Threshold(gray, binary, 0, 255, ThresholdTypes.Binary | ThresholdTypes.Otsu);
                // Small connected components are punch holes and scanner dust.
                RemoveSmallComponents(binary);
                var output = new Mat();
                Cv2.CvtColor(binary, output, ColorConversionCodes.GRAY2BGR);
                return output;
            }

            case "crop":
            {
                using var gray = new Mat();
                Cv2.CvtColor(src, gray, ColorConversionCodes.BGR2GRAY);
                using var binary = new Mat();
                Cv2.Threshold(gray, binary, 0, 255, ThresholdTypes.BinaryInv | ThresholdTypes.Otsu);
                using var nonZero = new Mat();
                Cv2.FindNonZero(binary, nonZero);
                if (nonZero.Empty()) return src.Clone();
                var rect = Cv2.BoundingRect(nonZero);
                // Guard against degenerate crops (a stray mark should not trim the page away).
                if (rect.Width < src.Width * 0.2 || rect.Height < src.Height * 0.2) return src.Clone();
                return new Mat(src, rect).Clone();
            }

            case "contrast":
            {
                using var gray = new Mat();
                Cv2.CvtColor(src, gray, ColorConversionCodes.BGR2GRAY);
                using var clahe = Cv2.CreateCLAHE(2.0, new Size(8, 8));
                using var equalized = new Mat();
                clahe.Apply(gray, equalized);
                var output = new Mat();
                Cv2.CvtColor(equalized, output, ColorConversionCodes.GRAY2BGR);
                return output;
            }

            default:
                return null;
        }
    }

    private static Mat RotateExact(Mat src, int degrees)
    {
        var flags = degrees switch
        {
            90 => RotateFlags.Rotate90Clockwise,
            180 => RotateFlags.Rotate180,
            270 => RotateFlags.Rotate90Counterclockwise,
            _ => RotateFlags.Rotate90Clockwise,
        };
        var rotated = new Mat();
        Cv2.Rotate(src, rotated, flags);
        return rotated;
    }

    private static double? MedianSkewAngle(Mat src)
    {
        using var gray = new Mat();
        Cv2.CvtColor(src, gray, ColorConversionCodes.BGR2GRAY);
        using var binary = new Mat();
        Cv2.Threshold(gray, binary, 0, 255, ThresholdTypes.BinaryInv | ThresholdTypes.Otsu);
        using var nonZero = new Mat();
        Cv2.FindNonZero(binary, nonZero);
        if (nonZero.Empty() || nonZero.Rows < 50) return null;

        var rect = Cv2.MinAreaRect(nonZero);
        var angle = rect.Angle;
        // minAreaRect angles are in [0, 90); a page leaning the other way reads as 90-angle.
        if (angle > 45) angle -= 90;
        return angle;
    }

    private static Mat RotateWithBounds(Mat src, double angle)
    {
        var center = new Point2f(src.Cols / 2f, src.Rows / 2f);
        using var rotation = Cv2.GetRotationMatrix2D(center, angle, 1.0);
        var cos = Math.Abs(rotation.At<double>(0, 0));
        var sin = Math.Abs(rotation.At<double>(0, 1));
        var bounds = new Size((int)(src.Rows * sin + src.Cols * cos), (int)(src.Rows * cos + src.Cols * sin));
        var rotated = new Mat();
        Cv2.WarpAffine(src, rotated, rotation, bounds, InterpolationFlags.Linear, BorderTypes.Replicate);
        return rotated;
    }

    private static void RemoveSmallComponents(Mat binary)
    {
        using var labels = new Mat();
        using var stats = new Mat();
        using var centroids = new Mat();
        var count = Cv2.ConnectedComponentsWithStats(binary, labels, stats, centroids);
        // Components under 0.05% of the page are specks.
        var threshold = binary.Rows * binary.Cols * 0.0005;
        for (var label = 1; label < count; label++)
        {
            var area = stats.At<int>(label, (int)ConnectedComponentsTypes.Area);
            if (area >= threshold) continue;
            using var mask = new Mat();
            Cv2.Compare(labels, label, mask, CmpTypes.EQ);
            binary.SetTo(0, mask);
        }
    }
}
