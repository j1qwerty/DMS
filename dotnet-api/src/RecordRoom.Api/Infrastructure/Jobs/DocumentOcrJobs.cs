using Microsoft.EntityFrameworkCore;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Application.Services;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Auth;
using RecordRoom.Api.Infrastructure.Data;
using RecordRoom.Api.Infrastructure.Ocr;

namespace RecordRoom.Api.Infrastructure.Jobs;

/// <summary>
/// Background OCR for uploaded document versions (the file-detail "Upload PDF"
/// path). The upload request stores the bytes and returns immediately; this job
/// walks the document page by page, persists each page's text in
/// <see cref="DocumentVersionPage"/> and announces progress so the reader can
/// refresh. Because every page's text is written once into SQL, opening the OCR
/// panel or tab later serves the stored rows and never re-runs recognition.
///
/// The job is idempotent: a page that already carries a timestamped result is
/// skipped, so a retry (or a re-enqueue after a crash) resumes where it stopped
/// instead of repeating tesseract over pages that are already done.
/// </summary>
public class DocumentOcrJobs(
    IServiceProvider services,
    ILogger<DocumentOcrJobs> logger)
{
    [Hangfire.DisableConcurrentExecution(timeoutInSeconds: 1800)]
    public async Task ExtractAsync(int fileId, long documentId, CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var ocr = scope.ServiceProvider.GetRequiredService<IOcrService>();
        var configuration = scope.ServiceProvider
            .GetRequiredService<Microsoft.Extensions.Configuration.IConfiguration>();

        var doc = await db.FileDocuments.AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == documentId && d.RecordFileId == fileId, ct);
        if (doc is null) return;

        var total = Math.Max(1, doc.PageCount ?? 1);
        var enabled = configuration.GetValue("Ocr:Enabled", true);

        for (var pageNo = 1; pageNo <= total; pageNo++)
        {
            ct.ThrowIfCancellationRequested();

            var existing = await db.DocumentPages.AsNoTracking()
                .Where(p => p.DocumentId == documentId && p.PageNo == pageNo)
                .Select(p => p.OcrRanAt)
                .FirstOrDefaultAsync(ct);
            if (existing is not null) continue; // already persisted — never regenerate

            OcrExtraction extraction = new("", "none");
            if (enabled)
            {
                try
                {
                    extraction = await ocr.ExtractAsync(
                        doc.StorageKey, doc.ContentType, pageNo, ct);
                }
                catch (Exception ex)
                {
                    // Best effort, like the scan-page job: one page's failure
                    // must not stop the rest of the document.
                    logger.LogWarning(ex, "Background OCR failed for document {DocumentId} page {PageNo}.",
                        documentId, pageNo);
                }
            }

            var row = await db.DocumentPages
                .FirstOrDefaultAsync(p => p.DocumentId == documentId && p.PageNo == pageNo, ct);
            if (row is null)
            {
                row = new DocumentVersionPage { DocumentId = documentId, PageNo = pageNo };
                db.DocumentPages.Add(row);
            }
            row.OcrText = extraction.Text;
            row.OcrMethod = extraction.Method;
            row.OcrRanAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);

            try
            {
                await AnnounceAsync(scope, fileId, documentId, pageNo, total,
                    $"Page {pageNo} of {total} processed for {doc.OriginalFileName}");
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Could not announce OCR progress for document {DocumentId}.", documentId);
            }
        }

        logger.LogInformation(
            "Background document OCR finished for {DocumentId} ({FileName}, {Pages} page(s)).",
            documentId, doc.OriginalFileName, total);
    }

    private static async Task AnnounceAsync(
        IServiceScope scope, int fileId, long documentId, int pageNo, int total, string message)
    {
        var audit = scope.ServiceProvider.GetRequiredService<IAuditWriter>();
        await audit.AnnounceAsync(
            RealtimeChannels.Digitization, "document.ocr", $"{documentId}:{pageNo}",
            $"{message} ({pageNo}/{total})");
    }
}
