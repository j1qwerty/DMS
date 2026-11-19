using Microsoft.EntityFrameworkCore;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Data;
using RecordRoom.Api.Infrastructure.Ocr;

namespace RecordRoom.Api.Application.Services;

/// <summary>
/// OCR as a stored, re-runnable step (round 3 — the Hindi scan gap). Uploads
/// extract text inline; this service is the explicit re-run, with an audit row
/// each time so the trail says whose text the register is searching.
/// </summary>
public interface IOcrService
{
    /// <summary>Reads a stored blob and extracts its text; empty text, never an error, when nothing can be read.</summary>
    Task<OcrExtraction> ExtractAsync(string storageKey, string contentType, CancellationToken ct = default);

    /// <summary>Re-runs OCR for one scan page and stores the result.</summary>
    Task<Result<ScanOcrDto>> RunAsync(long scanId, CancellationToken ct = default);
}

public sealed class OcrService(
    AppDbContext db,
    IAuditWriter audit,
    ICurrentUserAccessor current,
    IPrivateDocumentStore documentStore,
    OcrTextExtractor extractor) : IOcrService
{
    public async Task<OcrExtraction> ExtractAsync(string storageKey, string contentType, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(storageKey)) return new OcrExtraction("", "none");
        await using var stream = await documentStore.OpenReadAsync(storageKey, ct);
        if (stream is null) return new OcrExtraction("", "none");

        using var memory = new MemoryStream();
        await stream.CopyToAsync(memory, ct);
        return await extractor.ExtractAsync(memory.ToArray(), contentType, ct);
    }

    public async Task<Result<ScanOcrDto>> RunAsync(long scanId, CancellationToken ct = default)
    {
        var page = await db.ScanPages.FirstOrDefaultAsync(p => p.Id == scanId, ct);
        if (page is null) return Result<ScanOcrDto>.Fail("Scan page not found.", "scanId");
        if (string.IsNullOrWhiteSpace(page.StorageKey))
            return Result<ScanOcrDto>.Fail("This page has no stored scan to read.", "document");

        var extraction = await ExtractAsync(page.StorageKey, page.ContentType ?? "application/octet-stream", ct);
        var before = string.IsNullOrWhiteSpace(page.OcrText) ? "no text" : $"{page.OcrText.Length} characters";
        page.OcrText = extraction.Text;

        var actor = current.User?.DisplayName ?? current.UserName;
        await audit.LogAsync(
            db, AuditAction.Update, "FileScanPage", page.Id.ToString(), before,
            extraction.Found ? $"{extraction.Text.Length} characters via {extraction.Method}" : "no text found",
            $"OCR re-run for page {page.PageNo} of {page.Barcode} by {actor}: {extraction.Method}.", ct);
        await db.SaveChangesAsync(ct);

        return Result<ScanOcrDto>.Ok(new ScanOcrDto(
            page.Id, page.Barcode, page.PageNo, page.Version,
            extraction.Text, extraction.Method, DateTime.UtcNow));
    }
}
