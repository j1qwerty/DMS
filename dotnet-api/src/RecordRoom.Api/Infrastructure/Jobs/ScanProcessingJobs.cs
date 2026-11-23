using Microsoft.EntityFrameworkCore;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Application.Services;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Auth;
using RecordRoom.Api.Infrastructure.Data;
using RecordRoom.Api.Infrastructure.Ocr;
using RecordRoom.Api.Infrastructure.Realtime;

namespace RecordRoom.Api.Infrastructure.Jobs;

/// <summary>
/// Background scan processing: the OCR pass that used to run inside the upload
/// request. A multi-page Hindi scan can take minutes through tesseract, so the
/// upload now stores the document, marks the page "Processing" and returns
/// immediately; this job rasterizes and OCRs the stored bytes, writes the text
/// and moves the page to its real status. The frontend hears the
/// "page.processed" announcement on the digitization channel and refreshes.
///
/// In-memory Hangfire storage (the default) loses enqueued jobs on restart; a
/// page stuck on "Processing" after a crash is recovered by re-running OCR from
/// the studio or the OCR screen (both set the text and status directly).
/// </summary>
public class ScanProcessingJobs(
    IServiceProvider services,
    ILogger<ScanProcessingJobs> logger)
{
    /// <summary>
    /// Extracts the text of one stored scan page. The status the page lands on
    /// follows the same rule as the upload path: a duplicate when an active
    /// version of the same page exists, pending review otherwise — recomputed
    /// here so the job is self-contained.
    /// </summary>
    [Hangfire.DisableConcurrentExecution(timeoutInSeconds: 600)]
    public async Task ExtractOcrAsync(long scanId, CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var ocr = scope.ServiceProvider.GetRequiredService<IOcrService>();
        var audit = scope.ServiceProvider.GetRequiredService<IAuditWriter>();
        var configuration = scope.ServiceProvider
            .GetRequiredService<Microsoft.Extensions.Configuration.IConfiguration>();

        var page = await db.ScanPages.FirstOrDefaultAsync(p => p.Id == scanId, ct);
        // Gone, or already finished by another path (manual re-run): nothing to do.
        if (page is null || page.StorageKey is null || page.Status != PageStatus.Processing) return;

        var text = "";
        if (configuration.GetValue("Ocr:Enabled", true))
        {
            try
            {
                var extraction = await ocr.ExtractAsync(
                    page.StorageKey, page.ContentType ?? "application/octet-stream", ct);
                text = extraction.Text;
            }
            catch (Exception ex)
            {
                // Best effort, exactly like the old inline pass: an OCR failure
                // must never leave the page stuck or the job retrying forever.
                logger.LogWarning(ex, "Background OCR failed for scan {ScanId}.", scanId);
            }
        }

        // Duplicate when an active version of the same page exists; pending
        // review otherwise. Same rule the upload path applied when it marked
        // the page Processing.
        var hasActiveSibling = await db.ScanPages.AnyAsync(
            p => p.Barcode == page.Barcode && p.PageNo == page.PageNo
                && p.Status == PageStatus.Active && p.Id != page.Id, ct);

        page.OcrText = text;
        page.Status = hasActiveSibling ? PageStatus.Duplicate : PageStatus.PendingReview;
        await db.SaveChangesAsync(ct);

        try
        {
            await audit.AnnounceAsync(RealtimeChannels.Digitization, "page.processed",
                page.Id.ToString(), $"Scan processed: {page.FileName}");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not announce OCR completion for scan {ScanId}.", scanId);
        }

        logger.LogInformation("Background OCR finished for scan {ScanId} ({Status}, {Chars} characters).",
            scanId, page.Status, text.Length);
    }

    /// <summary>
    /// Background extraction of all pages of an uploaded file document (RecordFileDocument).
    /// Stores the extracted page dictionary as JSON cache in PrivateDocumentStore.
    /// </summary>
    [Hangfire.DisableConcurrentExecution(timeoutInSeconds: 600)]
    public async Task ExtractDocumentOcrAsync(long documentId, CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var documentStore = scope.ServiceProvider.GetRequiredService<IPrivateDocumentStore>();
        var extractor = scope.ServiceProvider.GetRequiredService<OcrTextExtractor>();
        var audit = scope.ServiceProvider.GetRequiredService<IAuditWriter>();

        var doc = await db.FileDocuments.Include(d => d.RecordFile).FirstOrDefaultAsync(d => d.Id == documentId, ct);
        if (doc is null || string.IsNullOrWhiteSpace(doc.StorageKey)) return;

        var existing = await documentStore.ReadOcrAsync(doc.StorageKey, ct);
        if (!string.IsNullOrWhiteSpace(existing)) return;

        await using var stream = await documentStore.OpenReadAsync(doc.StorageKey, ct);
        if (stream is null) return;
        using var ms = new MemoryStream();
        await stream.CopyToAsync(ms, ct);
        var bytes = ms.ToArray();

        var pages = await extractor.ExtractPagesAsync(bytes, doc.ContentType, ct);
        if (pages.Count > 0)
        {
            var json = System.Text.Json.JsonSerializer.Serialize(pages);
            await documentStore.SaveOcrAsync(doc.StorageKey, json, ct);
            logger.LogInformation("Background OCR finished for document {DocumentId} ({Count} pages).", documentId, pages.Count);
            try
            {
                await audit.AnnounceAsync(RealtimeChannels.Digitization, "document.ocr.processed",
                    doc.Id.ToString(), $"Document OCR ready for {doc.OriginalFileName}");
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Could not announce OCR completion for document {DocumentId}.", documentId);
            }
        }
    }
}
