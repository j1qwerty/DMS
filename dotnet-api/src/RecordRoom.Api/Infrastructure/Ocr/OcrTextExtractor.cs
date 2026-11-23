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

    /// <summary>
    /// One page of a stored document version. A typed PDF answers from its own
    /// text layer (fast and exact); a scanned PDF page is rasterized and read
    /// by tesseract like the scan-page path. Images are page 1 of themselves.
    /// </summary>
    public async Task<OcrExtraction> ExtractAsync(byte[] blob, string contentType, int pageNo, CancellationToken ct = default)
    {
        if (!Enabled || blob.Length == 0) return new OcrExtraction("", "none");
        if (pageNo < 1) return new OcrExtraction("", "none");

        if (contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
        {
            if (!engine.IsAvailable) return new OcrExtraction("", "none");
            var imageText = pageNo == 1 ? await engine.RunAsync(blob, ct) : null;
            return new OcrExtraction(imageText ?? "", imageText is null ? "none" : $"tesseract {engine.Languages}");
        }

        if (contentType != "application/pdf") return new OcrExtraction("", "none");

        // Typed PDFs keep their text in the page tree — reading it costs one
        // Docnet call instead of a raster + tesseract pass.
        var typed = ReadPdfTextLayer(blob, pageNo);
        if (typed is not null) return new OcrExtraction(typed, "pdf-text-layer");

        if (!engine.IsAvailable) return new OcrExtraction("", "none");
        var png = RenderPdfPage(blob, pageNo - 1);
        if (png is null) return new OcrExtraction("", "none");
        var ocrText = await engine.RunAsync(png, ct);
        return new OcrExtraction(ocrText ?? "", ocrText is null ? "none" : $"tesseract {engine.Languages}");
    }

    /// <summary>The embedded text of one PDF page; null when the page carries none (a scan).</summary>
    private string? ReadPdfTextLayer(byte[] pdf, int pageNo)
    {
        try
        {
            using var doc = DocLib.Instance.GetDocReader(
                pdf, new Docnet.Core.Models.PageDimensions(RenderWidth, RenderHeight));
            if (pageNo < 1 || pageNo > doc.GetPageCount()) return null;
            using var reader = doc.GetPageReader(pageNo - 1);
            var text = reader.GetText();
            return string.IsNullOrWhiteSpace(text) ? null : text.Trim();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "PDFium could not read the text layer of page {PageNo}.", pageNo);
            return null;
        }
    }

    /// <summary>Each page as PNG bytes at the OCR render size; empty when PDFium cannot open the bytes.</summary>
    private List<byte[]> RenderPdfPages(byte[] pdf)
    {
        try
        {
            using var doc = DocLib.Instance.GetDocReader(
                pdf, new Docnet.Core.Models.PageDimensions(RenderWidth, RenderHeight));
            var pages = new List<byte[]>();
            for (var i = 0; i < Math.Min(doc.GetPageCount(), MaxPdfPages); i++)
            {
                var png = RenderPdfPage(doc, i);
                if (png is not null) pages.Add(png);
            }
            return pages;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "PDFium could not rasterize this document for OCR.");
            return [];
        }
    }

    /// <summary>One page as PNG bytes, or null when it cannot be rasterized.</summary>
    private byte[]? RenderPdfPage(byte[] pdf, int pageIndex)
    {
        try
        {
            using var doc = DocLib.Instance.GetDocReader(
                pdf, new Docnet.Core.Models.PageDimensions(RenderWidth, RenderHeight));
            return RenderPdfPage(doc, pageIndex);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "PDFium could not rasterize page {PageIndex} for OCR.", pageIndex + 1);
            return null;
        }
    }

    private byte[]? RenderPdfPage(Docnet.Core.Readers.IDocReader doc, int pageIndex)
    {
        if (pageIndex < 0 || pageIndex >= doc.GetPageCount()) return null;
        using var reader = doc.GetPageReader(pageIndex);
        // Docnet hands back B-G-R-A, four bytes per pixel; reading it as
        // three-channel data sheared every row and gave tesseract garbage.
        var raw = reader.GetImage();
        var handle = System.Runtime.InteropServices.GCHandle.Alloc(
            raw, System.Runtime.InteropServices.GCHandleType.Pinned);
        try
        {
            using var wrapped = Mat.FromPixelData(
                reader.GetPageHeight(), reader.GetPageWidth(), MatType.CV_8UC4,
                handle.AddrOfPinnedObject());
            using var bgr = new Mat();
            Cv2.CvtColor(wrapped, bgr, ColorConversionCodes.BGRA2BGR);
            Cv2.ImEncode(".png", bgr, out var bytes);
            return bytes;
        }
        finally
        {
            handle.Free();
        }
    }
}
