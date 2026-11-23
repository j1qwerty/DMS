using Hangfire;
using System.Text.Json;
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
    Task<Result<RecordFileDocumentDto>> UploadAsync(int fileId, IFormFile? document, CancellationToken ct = default, bool importToStudio = false);
    Task<PrivateDocumentContent?> OpenAsync(int fileId, long documentId, CancellationToken ct = default);
    Task<Result<bool>> DeleteAsync(int fileId, long documentId, CancellationToken ct = default);
    Task<Dictionary<int, string>?> GetOcrAsync(int fileId, long documentId, CancellationToken ct = default);
    Task<Result<bool>> SaveOcrPageAsync(int fileId, long documentId, int pageNo, string text, CancellationToken ct = default);
}

/// <summary>File-level attachments, versioned independently from page-by-page digitization.</summary>
public sealed class RecordFileDocumentsService(
    AppDbContext db, IPrivateDocumentStore documentStore, IAuditWriter audit,
    ICurrentUserAccessor current, ILogger<RecordFileDocumentsService> logger,
    IBackgroundJobClient backgroundJobs) : IRecordFileDocumentsService
{
    private static RecordFileDocumentDto ToDto(RecordFileDocument d, string barcode) =>
        new(d.Id, d.RecordFileId, barcode, d.Version, d.OriginalFileName, d.ContentType, d.SizeBytes, d.Sha256, d.UploadedAt, d.UploadedBy, d.PageCount, d.ImportToStudio);

    public async Task<RecordFileDocumentDto[]?> ListAsync(int fileId, CancellationToken ct = default)
    {
        var file = await db.Files.AsNoTracking().Where(f => f.Id == fileId)
            .Select(f => new { f.Id, f.Barcode }).FirstOrDefaultAsync(ct);
        if (file is null) return null;
        var rows = await db.FileDocuments.AsNoTracking().Where(d => d.RecordFileId == fileId)
            .OrderByDescending(d => d.Version).ToListAsync(ct);
        return rows.Select(d => ToDto(d, file.Barcode)).ToArray();
    }

    public async Task<Result<RecordFileDocumentDto>> UploadAsync(int fileId, IFormFile? document, CancellationToken ct = default, bool importToStudio = false)
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
            PageCount = stored.PageCount,
            ImportToStudio = importToStudio && stored.ContentType == "application/pdf"
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
        try
        {
            backgroundJobs.Enqueue<ScanProcessingJobs>(job => job.ExtractDocumentOcrAsync(row.Id, CancellationToken.None));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Could not queue processing for document {DocumentId}.", row.Id);
        }
        await audit.AnnounceAsync(RealtimeChannels.Files, "file.document.uploaded", fileId.ToString(),
            $"{stored.OriginalFileName} uploaded as version {version}");
        return Result<RecordFileDocumentDto>.Ok(ToDto(row, file.Barcode));
    }

    public async Task<Dictionary<int, string>?> GetOcrAsync(int fileId, long documentId, CancellationToken ct = default)
    {
        var row = await db.FileDocuments.AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == documentId && d.RecordFileId == fileId, ct);
        if (row is null) return null;

        return await ReadSavedOcrAsync(row, documentStore, logger, ct);
    }

    public async Task<Result<bool>> SaveOcrPageAsync(int fileId, long documentId, int pageNo, string text, CancellationToken ct = default)
    {
        var row = await db.FileDocuments
            .FirstOrDefaultAsync(d => d.Id == documentId && d.RecordFileId == fileId, ct);
        if (row is null) return Result<bool>.Fail("Document not found.", "documentId");
        if (pageNo < 1 || pageNo > (row.PageCount ?? (row.ContentType == "application/pdf" ? int.MaxValue : 1)))
            return Result<bool>.Fail("Page is outside this document.", "pageNo");

        while (db.Entry(row).State != EntityState.Detached)
        {
            var pages = await ReadSavedOcrAsync(row, documentStore, logger, ct);
            pages[pageNo] = text;
            row.OcrPagesJson = JsonSerializer.Serialize(pages);
            row.OcrRevision++;
            try
            {
                await db.SaveChangesAsync(ct);
                await audit.AnnounceAsync(RealtimeChannels.Digitization, "document.ocr.updated",
                    row.Id.ToString(), $"OCR correction saved for {row.OriginalFileName}");
                return Result<bool>.Ok(true);
            }
            catch (DbUpdateConcurrencyException)
            {
                await db.Entry(row).ReloadAsync(ct);
            }
        }
        return Result<bool>.Fail("Document not found.", "documentId");
    }

    internal static async Task<Dictionary<int, string>> ReadSavedOcrAsync(
        RecordFileDocument row, IPrivateDocumentStore store, ILogger logger, CancellationToken ct)
    {
        if (row.OcrPagesJson is { } json)
            return JsonSerializer.Deserialize<Dictionary<int, string>>(json) ?? [];

        try
        {
            var legacy = await store.ReadOcrAsync(row.StorageKey, ct);
            return legacy is null ? [] : JsonSerializer.Deserialize<Dictionary<int, string>>(legacy) ?? [];
        }
        catch (Exception ex) when (ex is JsonException or IOException)
        {
            logger.LogWarning(ex, "Could not read legacy OCR for document {DocumentId}.", row.Id);
            return [];
        }
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

    private async Task TryDeleteAsync(string key)
    {
        try { await documentStore.DeleteAsync(key, CancellationToken.None); }
        catch (Exception ex) { logger.LogError(ex, "Could not clean up document key {StorageKey}.", key); }
    }
}
