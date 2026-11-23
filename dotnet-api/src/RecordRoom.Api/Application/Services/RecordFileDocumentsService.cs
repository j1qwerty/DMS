using Hangfire;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Auth;
using RecordRoom.Api.Infrastructure.Data;
using RecordRoom.Api.Infrastructure.Jobs;
using RecordRoom.Api.Infrastructure.Realtime;

namespace RecordRoom.Api.Application.Services;

public interface IRecordFileDocumentsService
{
    Task<RecordFileDocumentDto[]?> ListAsync(int fileId, CancellationToken ct = default);
    Task<Result<RecordFileDocumentDto>> UploadAsync(int fileId, IFormFile? document, CancellationToken ct = default);
    Task<PrivateDocumentContent?> OpenAsync(int fileId, long documentId, CancellationToken ct = default);
    Task<Result<bool>> DeleteAsync(int fileId, long documentId, CancellationToken ct = default);

    /// <summary>
    /// Every page of one stored document version with its persisted OCR text —
    /// the reader's OCR side panel and the OCR tab both render from this, so
    /// opening either never re-runs recognition.
    /// </summary>
    Task<DocumentVersionPageDto[]?> ListPagesAsync(int fileId, long documentId, CancellationToken ct = default);

    /// <summary>Page-count / has-text coverage of one document version.</summary>
    Task<DocumentOcrStatusDto?> OcrStatusAsync(int fileId, long documentId, CancellationToken ct = default);

    /// <summary>Re-runs recognition for one page of a stored document version and persists it.</summary>
    Task<Result<DocumentVersionPageDto>> RunPageOcrAsync(int fileId, long documentId, int pageNo, CancellationToken ct = default);

    /// <summary>Saves a hand correction of one page's OCR text.</summary>
    Task<Result<DocumentVersionPageDto>> SavePageOcrTextAsync(int fileId, long documentId, int pageNo, string text, CancellationToken ct = default);
}

/// <summary>File-level attachments, versioned independently from page-by-page digitization.</summary>
public sealed class RecordFileDocumentsService(
    AppDbContext db,
    IPrivateDocumentStore documentStore,
    IAuditWriter audit,
    ICurrentUserAccessor current,
    IOcrService ocr,
    IBackgroundJobClient backgroundJobs,
    ILogger<RecordFileDocumentsService> logger) : IRecordFileDocumentsService
{
    private static RecordFileDocumentDto ToDto(RecordFileDocument d, string barcode) =>
        new(d.Id, d.RecordFileId, barcode, d.Version, d.OriginalFileName, d.ContentType, d.SizeBytes, d.Sha256, d.UploadedAt, d.UploadedBy, d.PageCount);

    private static DocumentVersionPageDto ToPageDto(DocumentVersionPage p) => new(
        p.Id, p.DocumentId, p.PageNo, p.OcrText, p.OcrMethod, p.OcrRanAt, p.OcrEditedBy, p.OcrEditedAt);

    public async Task<RecordFileDocumentDto[]?> ListAsync(int fileId, CancellationToken ct = default)
    {
        var file = await db.Files.AsNoTracking().Where(f => f.Id == fileId)
            .Select(f => new { f.Id, f.Barcode }).FirstOrDefaultAsync(ct);
        if (file is null) return null;
        var rows = await db.FileDocuments.AsNoTracking().Where(d => d.RecordFileId == fileId)
            .OrderByDescending(d => d.Version).ToListAsync(ct);
        return rows.Select(d => ToDto(d, file.Barcode)).ToArray();
    }

    public async Task<Result<RecordFileDocumentDto>> UploadAsync(int fileId, IFormFile? document, CancellationToken ct = default)
    {
        var file = await db.Files.AsNoTracking().FirstOrDefaultAsync(f => f.Id == fileId, ct);
        if (file is null) return Result<RecordFileDocumentDto>.Fail("Record not found.", "fileId");
        var storedResult = await documentStore.SaveAsync(document, ct);
        if (!storedResult.IsSuccess) return Result<RecordFileDocumentDto>.Fail(storedResult.Errors);
        var stored = storedResult.Value;
        var version = (await db.FileDocuments.AsNoTracking().Where(d => d.RecordFileId == fileId)
            .Select(d => (int?)d.Version).MaxAsync(ct) ?? 0) + 1;
        var row = new RecordFileDocument
        {
            RecordFileId = fileId, Version = version, OriginalFileName = stored.OriginalFileName,
            StorageKey = stored.StorageKey, ContentType = stored.ContentType, SizeBytes = stored.SizeBytes,
            Sha256 = stored.Sha256, UploadedAt = DateTime.UtcNow, UploadedBy = current.UserName,
            PageCount = stored.PageCount
        };
        db.FileDocuments.Add(row);
        await audit.LogAsync(db, AuditAction.Create, "RecordFileDocument", "pending", "-",
            $"{stored.OriginalFileName} v{version}; bytes={stored.SizeBytes}; sha256={stored.Sha256}",
            $"Uploaded attachment {stored.OriginalFileName} v{version} for {file.Barcode}", ct);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex)
        {
            logger.LogWarning(ex, "Could not register file attachment v{Version} for record {FileId}.", version, fileId);
            await TryDeleteAsync(stored.StorageKey);
            return Result<RecordFileDocumentDto>.Fail("This record was updated by another upload. Please retry.", "document");
        }
        catch { await TryDeleteAsync(stored.StorageKey); throw; }

        // Page extraction + OCR run in the background: the upload returns as
        // soon as the bytes are stored, and the pages fill in with their text
        // as the job finishes (the UI hears "document.ocr" announcements).
        backgroundJobs.Enqueue<DocumentOcrJobs>(job => job.ExtractAsync(fileId, row.Id));

        await audit.AnnounceAsync(RealtimeChannels.Files, "file.document.uploaded", fileId.ToString(),
            $"{stored.OriginalFileName} uploaded as version {version}");
        return Result<RecordFileDocumentDto>.Ok(ToDto(row, file.Barcode));
    }

    public async Task<PrivateDocumentContent?> OpenAsync(int fileId, long documentId, CancellationToken ct = default)
    {
        var row = await db.FileDocuments.AsNoTracking().Include(d => d.RecordFile)
            .FirstOrDefaultAsync(d => d.Id == documentId && d.RecordFileId == fileId, ct);
        if (row?.RecordFile is null) return null;
        var stream = await documentStore.OpenReadAsync(row.StorageKey, ct);
        return stream is null ? null : new PrivateDocumentContent(row.OriginalFileName, row.ContentType, row.SizeBytes, row.Sha256, stream);
    }

    /// <summary>Removes one stored scan version. Admin-only (enforced by the controller).</summary>
    public async Task<Result<bool>> DeleteAsync(int fileId, long documentId, CancellationToken ct = default)
    {
        var row = await db.FileDocuments.Include(d => d.RecordFile)
            .FirstOrDefaultAsync(d => d.Id == documentId && d.RecordFileId == fileId, ct);
        if (row?.RecordFile is null) return Result<bool>.Fail("Scan version not found.", "documentId");

        var barcode = row.RecordFile.Barcode;
        var key = row.StorageKey;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        db.FileDocuments.Remove(row);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(db, AuditAction.Delete, "RecordFileDocument", row.Id.ToString(),
            $"{row.OriginalFileName} v{row.Version}; bytes={row.SizeBytes}; sha256={row.Sha256}", "deleted",
            $"Deleted scan {row.OriginalFileName} v{row.Version} from {barcode}", ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        // The row is gone; a failed blob removal only leaks bytes, so it is
        // logged rather than rolled back.
        await TryDeleteAsync(key);
        await audit.AnnounceAsync(RealtimeChannels.Files, "file.document.deleted", fileId.ToString(),
            $"{row.OriginalFileName} v{row.Version} removed from {barcode}");
        return Result<bool>.Ok(true);
    }

    // ------------------------------------------------------------------ pages

    private async Task<RecordFileDocument?> FindDocumentAsync(int fileId, long documentId, CancellationToken ct) =>
        await db.FileDocuments.AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == documentId && d.RecordFileId == fileId, ct);

    private static int PageCountOf(RecordFileDocument doc)
    {
        // Images are a single page; PDFs carry their page count (null only when
        // the page tree could not be read — treat that as one page).
        var count = doc.PageCount ?? 1;
        return Math.Max(1, count);
    }

    public async Task<DocumentVersionPageDto[]?> ListPagesAsync(int fileId, long documentId, CancellationToken ct = default)
    {
        var doc = await FindDocumentAsync(fileId, documentId, ct);
        if (doc is null) return null;

        var rows = await db.DocumentPages.AsNoTracking()
            .Where(p => p.DocumentId == documentId)
            .OrderBy(p => p.PageNo)
            .ToListAsync(ct);

        // Rows exist only for pages the background pass has reached (or that
        // were corrected by hand); fill the gaps so the client can rely on a
        // dense 1..N sequence.
        var total = PageCountOf(doc);
        var byPage = rows.ToDictionary(p => p.PageNo);
        var list = new List<DocumentVersionPageDto>(total);
        for (var pageNo = 1; pageNo <= total; pageNo++)
        {
            list.Add(byPage.TryGetValue(pageNo, out var row)
                ? ToPageDto(row)
                : new DocumentVersionPageDto(0, documentId, pageNo, "", "", null, null, null));
        }
        return list.ToArray();
    }

    public async Task<DocumentOcrStatusDto?> OcrStatusAsync(int fileId, long documentId, CancellationToken ct = default)
    {
        var doc = await FindDocumentAsync(fileId, documentId, ct);
        if (doc is null) return null;
        var total = PageCountOf(doc);
        var rows = await db.DocumentPages.AsNoTracking()
            .Where(p => p.DocumentId == documentId)
            .Select(p => new { p.PageNo, p.OcrRanAt, p.OcrText })
            .ToListAsync(ct);
        var withText = rows.Count(r => !string.IsNullOrWhiteSpace(r.OcrText));
        var processed = rows.Count;
        return new DocumentOcrStatusDto(documentId, total, withText, processed < total);
    }

    public async Task<Result<DocumentVersionPageDto>> RunPageOcrAsync(
        int fileId, long documentId, int pageNo, CancellationToken ct = default)
    {
        var doc = await FindDocumentAsync(fileId, documentId, ct);
        if (doc is null) return Result<DocumentVersionPageDto>.Fail("Document not found.", "documentId");
        var total = PageCountOf(doc);
        if (pageNo < 1 || pageNo > total)
            return Result<DocumentVersionPageDto>.Fail($"Page number must be between 1 and {total}.", "pageNo");

        // Re-running recognition always re-reads the stored bytes; the result
        // is then persisted, so the next open serves it from SQL.
        var extraction = await ocr.ExtractAsync(doc.StorageKey, doc.ContentType, pageNo, ct);
        var row = await db.DocumentPages.FirstOrDefaultAsync(p => p.DocumentId == documentId && p.PageNo == pageNo, ct);
        if (row is null)
        {
            row = new DocumentVersionPage { DocumentId = documentId, PageNo = pageNo };
            db.DocumentPages.Add(row);
        }
        row.OcrText = extraction.Text;
        row.OcrMethod = extraction.Method;
        row.OcrRanAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        await audit.AnnounceAsync(RealtimeChannels.Digitization, "document.ocr",
            $"{documentId}:{pageNo}", $"OCR re-run for page {pageNo} of {doc.OriginalFileName}");
        return Result<DocumentVersionPageDto>.Ok(ToPageDto(row));
    }

    public async Task<Result<DocumentVersionPageDto>> SavePageOcrTextAsync(
        int fileId, long documentId, int pageNo, string text, CancellationToken ct = default)
    {
        var doc = await FindDocumentAsync(fileId, documentId, ct);
        if (doc is null) return Result<DocumentVersionPageDto>.Fail("Document not found.", "documentId");
        var total = PageCountOf(doc);
        if (pageNo < 1 || pageNo > total)
            return Result<DocumentVersionPageDto>.Fail($"Page number must be between 1 and {total}.", "pageNo");

        var row = await db.DocumentPages.FirstOrDefaultAsync(p => p.DocumentId == documentId && p.PageNo == pageNo, ct);
        if (row is null)
        {
            row = new DocumentVersionPage { DocumentId = documentId, PageNo = pageNo };
            db.DocumentPages.Add(row);
        }
        row.OcrText = text;
        row.OcrMethod = string.IsNullOrWhiteSpace(text) ? row.OcrMethod : "hand-corrected";
        row.OcrRanAt ??= DateTime.UtcNow;
        row.OcrEditedBy = current.User?.DisplayName ?? current.UserName;
        row.OcrEditedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        await audit.AnnounceAsync(RealtimeChannels.Digitization, "document.ocr",
            $"{documentId}:{pageNo}", $"OCR text corrected for page {pageNo} of {doc.OriginalFileName}");
        return Result<DocumentVersionPageDto>.Ok(ToPageDto(row));
    }

    private async Task TryDeleteAsync(string key)
    {
        try { await documentStore.DeleteAsync(key, CancellationToken.None); }
        catch (Exception ex) { logger.LogError(ex, "Could not clean up document key {StorageKey}.", key); }
    }
}
