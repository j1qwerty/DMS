using Docnet.Core;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using OpenCvSharp;

namespace RecordRoom.Api.Infrastructure.Ocr;

/// <summary>What a pass produced, and how — surfaced in the UI so the reader knows what they are looking at.</summary>
public sealed record OcrExtraction(string Text, string Method)
{
    public bool Found => !string.IsNullOrWhiteSpace(Text);
}

/// <summary>
/// Text out of a stored scan (round 3 — the Hindi OCR gap). Every PDF — typed
/// or scanned — is rasterized by PDFium at the scan floor resolution and read
/// by tesseract (hin+eng by default); images go straight to tesseract. The
/// rendered text of a typed PDF is crisp, so the same path serves both, and
/// whatever it reads lands in the <c>OcrText</c> column the registry search
/// reads. If tesseract is not installed the extractor reports "none" instead
/// of failing the upload.
/// </summary>
public sealed class OcrTextExtractor(
    IOcrEngine engine,
    IConfiguration configuration,
    ILogger<OcrTextExtractor> logger)
{
    /// <summary>OCR render size for an A4 page — about 200 DPI, the project's own scan floor.</summary>
    private const int RenderWidth = 1654;
    private const int RenderHeight = 2339;

    /// <summary>
    /// Bound on how many PDF pages one pass will rasterize; a scan row is
    /// normally one page. Configurable via <c>Ocr:MaxPdfPages</c> because the
    /// right ceiling depends on the hardware — each page is a tesseract run.
    /// </summary>
    private int MaxPdfPages => Math.Max(1, configuration.GetValue("Ocr:MaxPdfPages", 10));

    private bool Enabled => configuration.GetValue("Ocr:Enabled", true);

    public async Task<OcrExtraction> ExtractAsync(byte[] blob, string contentType, CancellationToken ct = default)
    {
        if (!Enabled || blob.Length == 0) return new OcrExtraction("", "none");

        if (contentType == "application/pdf")
        {
            if (!engine.IsAvailable) return new OcrExtraction("", "none");

            var texts = new List<string>();
            foreach (var png in RenderPdfPages(blob))
            {
                ct.ThrowIfCancellationRequested();
                var text = await engine.RunAsync(png, ct);
                if (!string.IsNullOrWhiteSpace(text)) texts.Add(text.Trim());
            }
            return texts.Count == 0
                ? new OcrExtraction("", "none")
                : new OcrExtraction(string.Join("\n\n", texts), $"tesseract {engine.Languages}");
        }

        if (contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) && engine.IsAvailable)
        {
            var text = await engine.RunAsync(blob, ct);
            return new OcrExtraction(text ?? "", text is null ? "none" : $"tesseract {engine.Languages}");
        }

        return new OcrExtraction("", "none");
    }

    /// <summary>Extracts text for each page of the document individually (1-based page index).</summary>
    public async Task<Dictionary<int, string>> ExtractPagesAsync(
        byte[] blob, string contentType, CancellationToken ct = default,
        IReadOnlyDictionary<int, string>? saved = null)
    {
        var result = new Dictionary<int, string>();
        if (!Enabled || blob.Length == 0) return result;

        if (contentType == "application/pdf")
        {
            foreach (var (pageNo, image) in RasterizePdf(blob))
            {
                ct.ThrowIfCancellationRequested();
                if (saved?.ContainsKey(pageNo) == true) continue;
                var text = engine.IsAvailable ? await engine.RunAsync(image, ct) : "";
                result[pageNo] = text?.Trim() ?? "";
            }
            return result;
        }

        if (contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) && saved?.ContainsKey(1) != true)
        {
            var text = engine.IsAvailable ? await engine.RunAsync(blob, ct) : "";
            result[1] = text?.Trim() ?? "";
            return result;
        }

        return result;
    }

    /// <summary>Each page as PNG bytes at the OCR render size; empty when PDFium cannot open the bytes.</summary>
    private List<byte[]> RenderPdfPages(byte[] pdf)
    {
        try
        {
            return RasterizePdf(pdf, MaxPdfPages).Select(page => page.Image).ToList();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "PDFium could not rasterize this document for OCR.");
            return [];
        }
    }

    internal static IEnumerable<(int PageNo, byte[] Image)> RasterizePdf(byte[] pdf, int limit = int.MaxValue)
    {
        using var doc = DocLib.Instance.GetDocReader(
            pdf, new Docnet.Core.Models.PageDimensions(RenderWidth, RenderHeight));
        for (var i = 0; i < Math.Min(doc.GetPageCount(), limit); i++)
        {
            byte[] bytes;
            using (var reader = doc.GetPageReader(i))
            {
                var raw = reader.GetImage();
                using var wrapped = Mat.FromPixelData(
                    reader.GetPageHeight(), reader.GetPageWidth(), MatType.CV_8UC4, raw);
                using var bgr = new Mat();
                Cv2.CvtColor(wrapped, bgr, ColorConversionCodes.BGRA2BGR);
                Cv2.ImEncode(".png", bgr, out bytes);
            }
            yield return (i + 1, bytes);
        }
    }
}
