using System.Text.Json;
using Hangfire;
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
            catch (Exception ex) when (ex is not OperationCanceledException)
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

        await db.Entry(page).ReloadAsync(ct);
        if (db.Entry(page).State == EntityState.Detached || page.Status != PageStatus.Processing) return;
        if (!string.IsNullOrWhiteSpace(text) && string.IsNullOrWhiteSpace(page.OcrText)) page.OcrText = text;
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

    /// <summary>Queues unfinished attachments, including those created before database OCR.</summary>
    public async Task QueueUnprocessedDocumentsAsync(long afterId, CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var jobs = scope.ServiceProvider.GetRequiredService<IBackgroundJobClient>();
        var ids = await db.FileDocuments.AsNoTracking()
            .Where(d => d.Id > afterId && (d.OcrProcessedAt == null || d.ImportToStudio))
            .OrderBy(d => d.Id).Select(d => d.Id).Take(100).ToArrayAsync(ct);
        foreach (var id in ids)
            jobs.Enqueue<ScanProcessingJobs>(job => job.ExtractDocumentOcrAsync(id, CancellationToken.None));
        if (ids.Length == 100)
        {
            var lastId = ids[^1];
            jobs.Enqueue<ScanProcessingJobs>(job => job.QueueUnprocessedDocumentsAsync(lastId, CancellationToken.None));
        }
    }

    [DisableConcurrentExecution("recordroom-document-ocr", 600)]
    [AutomaticRetry(Attempts = 2)]
    public Task ExtractDocumentOcrAsync(long documentId, CancellationToken ct = default) =>
        ProcessDocumentAsync(documentId, rerun: false, ct);

    [DisableConcurrentExecution("recordroom-document-ocr", 600)]
    [AutomaticRetry(Attempts = 2)]
    public Task ReextractDocumentOcrAsync(long documentId, CancellationToken ct = default) =>
        ProcessDocumentAsync(documentId, rerun: true, ct);

    private async Task ProcessDocumentAsync(long documentId, bool rerun, CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var store = scope.ServiceProvider.GetRequiredService<IPrivateDocumentStore>();
        var extractor = scope.ServiceProvider.GetRequiredService<OcrTextExtractor>();
        var audit = scope.ServiceProvider.GetRequiredService<IAuditWriter>();
        var doc = await db.FileDocuments.Include(d => d.RecordFile).FirstOrDefaultAsync(d => d.Id == documentId, ct);
        if (doc?.RecordFile is not { } file || (!rerun && doc.OcrProcessedAt is not null && !doc.ImportToStudio)) return;

        var saved = await RecordFileDocumentsService.ReadSavedOcrAsync(doc, store, logger, ct);
        await using var stream = await store.OpenReadAsync(doc.StorageKey, ct);
        if (stream is null)
        {
            logger.LogWarning("Stored content is missing for document {DocumentId}.", documentId);
            return;
        }
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, ct);
        var bytes = buffer.ToArray();

        Dictionary<int, string>? extracted = null;
        Exception? extractionError = null;
        if (rerun || doc.OcrProcessedAt is null)
        {
            (extracted, extractionError) = await extractor.ExtractPagesAsync(
                bytes, doc.ContentType, ct, rerun ? null : saved);
            if (extractionError is not null)
                logger.LogWarning(extractionError, "OCR failed for document {DocumentId}.", documentId);
        }

        var studioPages = new List<(int Page, StoredDocument Document)>();
        var committed = false;
        try
        {
            if (doc.ImportToStudio)
            {
                foreach (var (page, image) in OcrTextExtractor.RasterizePdf(bytes))
                {
                    ct.ThrowIfCancellationRequested();
                    var name = $"{Path.GetFileNameWithoutExtension(doc.OriginalFileName)}-page-{page}.png";
                    var result = await store.SaveBytesAsync(image, name, "image/png", ct);
                    if (!result.IsSuccess) throw new IOException($"Could not store page {page} of document {documentId}.");
                    studioPages.Add((page, result.Value));
                }
                if (studioPages.Count == 0) throw new IOException($"Document {documentId} has no readable pages.");
            }

            while (db.Entry(doc).State != EntityState.Detached)
            {
                var pages = await RecordFileDocumentsService.ReadSavedOcrAsync(doc, store, logger, ct);
                if (extracted is not null)
                    foreach (var (page, text) in extracted)
                    {
                        if (!pages.TryAdd(page, text) && rerun && !string.IsNullOrWhiteSpace(text)
                            && pages[page] == saved.GetValueOrDefault(page))
                            pages[page] = text;
                    }

                if (doc.ImportToStudio && studioPages.Count > 0)
                {
                    var siblings = db.ScanPages.Where(d => d.Barcode == file.Barcode);
                    var nextPage = await siblings.MaxAsync(row => (int?)row.PageNo, ct) ?? 0;
                    var order = await siblings.MaxAsync(row => (int?)row.OrderIndex, ct) ?? 0;
                    foreach (var (page, stored) in studioPages)
                    {
                        db.ScanPages.Add(new FileScanPage
                        {
                            Barcode = file.Barcode, FileName = stored.OriginalFileName,
                            PageNo = ++nextPage, OrderIndex = ++order, DocumentSize = file.DocumentSize,
                            Status = PageStatus.PendingReview, Note = $"Imported from {doc.OriginalFileName}",
                            UploadedAt = doc.UploadedAt, UploadedBy = doc.UploadedBy,
                            StorageKey = stored.StorageKey, ContentType = stored.ContentType,
                            SizeBytes = stored.SizeBytes, Sha256 = stored.Sha256, OcrText = pages.GetValueOrDefault(page)
                        });
                    }
                    await audit.LogAsync(db, AuditAction.Create, "FileScanPage", doc.Id.ToString(),
                        "-", $"{studioPages.Count} pages from {doc.OriginalFileName}",
                        $"Imported PDF pages uploaded by {doc.UploadedBy} into Studio for {file.Barcode}", ct);
                    doc.ImportToStudio = false;
                }

                doc.OcrPagesJson = JsonSerializer.Serialize(pages);
                if (extracted is not null && extractionError is null) doc.OcrProcessedAt = DateTime.UtcNow;
                doc.OcrRevision++;
                try
                {
                    await db.SaveChangesAsync(ct);
                    committed = true;
                    break;
                }
                catch (DbUpdateConcurrencyException)
                {
                    foreach (var entry in db.ChangeTracker.Entries().Where(e => e.State == EntityState.Added).ToList())
                        entry.State = EntityState.Detached;
                    await db.Entry(doc).ReloadAsync(ct);
                }
            }
        }
        finally
        {
            if (!committed)
            {
                foreach (var (_, stored) in studioPages)
                    await store.DeleteAsync(stored.StorageKey, CancellationToken.None);
            }
        }

        if (committed)
        {
            try
            {
                await audit.AnnounceAsync(RealtimeChannels.Digitization, "document.ocr.processed",
                    doc.Id.ToString(), $"Document processed: {doc.OriginalFileName}");
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Could not announce processing for document {DocumentId}.", documentId);
            }
        }

        if (extractionError is not null)
            throw new InvalidOperationException($"OCR failed for document {documentId}.", extractionError);
    }
}
