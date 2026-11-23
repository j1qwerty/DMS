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
/// Renders PDFs with PDFium and reads each image with the selected OCR engine.
/// </summary>
public sealed class OcrTextExtractor(
    IOcrEngineSelector engines,
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
        if (contentType != "application/pdf" && !contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            return new OcrExtraction("", "none");
        var engine = await engines.GetAsync(ct);

        if (contentType == "application/pdf")
        {
            if (!engine.IsAvailable && engine.Name == OcrEngineNames.Tesseract) return new OcrExtraction("", "none");

            var texts = new List<string>();
            foreach (var png in RenderPdfPages(blob))
            {
                ct.ThrowIfCancellationRequested();
                var text = await engine.RunAsync(png, ct);
                if (!string.IsNullOrWhiteSpace(text)) texts.Add(text.Trim());
            }
            return texts.Count == 0
                ? new OcrExtraction("", "none")
                : new OcrExtraction(string.Join("\n\n", texts), $"{engine.Name} {engine.Languages}");
        }

        if (engine.IsAvailable || engine.Name == OcrEngineNames.Paddle)
        {
            var text = await engine.RunAsync(blob, ct);
            return new OcrExtraction(text ?? "", text is null ? "none" : $"{engine.Name} {engine.Languages}");
        }

        return new OcrExtraction("", "none");
    }

    internal async Task<(Dictionary<int, string> Pages, Exception? Error)> ExtractPagesAsync(
        byte[] blob, string contentType, CancellationToken ct = default,
        IReadOnlyDictionary<int, string>? saved = null)
    {
        var result = new Dictionary<int, string>();
        if (!Enabled || blob.Length == 0) return (result, null);

        try
        {
            var engine = await engines.GetAsync(ct);
            if (contentType == "application/pdf")
            {
                foreach (var (pageNo, image) in RasterizePdf(blob, skip: page => saved?.ContainsKey(page) == true))
                {
                    ct.ThrowIfCancellationRequested();
                    result[pageNo] = await ReadPageAsync(image);
                }
            }
            else if (contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) && saved?.ContainsKey(1) != true)
            {
                result[1] = await ReadPageAsync(blob);
            }

            async Task<string> ReadPageAsync(byte[] image)
            {
                if (!engine.IsAvailable) throw new OcrEngineException(engine.Describe().Note);
                return (await engine.RunAsync(image, ct))?.Trim() ?? "";
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return (result, ex);
        }

        return (result, null);
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

    internal static IEnumerable<(int PageNo, byte[] Image)> RasterizePdf(
        byte[] pdf, int limit = int.MaxValue, Func<int, bool>? skip = null)
    {
        using var doc = DocLib.Instance.GetDocReader(
            pdf, new Docnet.Core.Models.PageDimensions(RenderWidth, RenderHeight));
        for (var i = 0; i < Math.Min(doc.GetPageCount(), limit); i++)
        {
            if (skip?.Invoke(i + 1) == true) continue;
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
