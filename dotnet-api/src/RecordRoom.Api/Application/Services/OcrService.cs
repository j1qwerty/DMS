using Microsoft.EntityFrameworkCore;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Data;
using RecordRoom.Api.Infrastructure.Ocr;
using RecordRoom.Api.Infrastructure.Auth;

namespace RecordRoom.Api.Application.Services;

/// <summary>
/// OCR as a stored, re-runnable step. Uploads queue background extraction.
/// This service handles the explicit re-run, with an audit row
/// each time so the trail says whose text the register is searching.
/// </summary>
public interface IOcrService
{
    /// <summary>Reads a stored blob and extracts its text with the selected engine.</summary>
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

        var originalText = page.OcrText;
        OcrExtraction extraction;
        string? failure = null;
        try
        {
            extraction = await ExtractAsync(page.StorageKey, page.ContentType ?? "application/octet-stream", ct);
        }
        catch (OcrEngineException ex)
        {
            extraction = new OcrExtraction("", "none");
            failure = ex.Message;
        }

        await db.Entry(page).ReloadAsync(ct);
        if (db.Entry(page).State == EntityState.Detached)
            return Result<ScanOcrDto>.Fail("Scan page not found.", "scanId");
        if (extraction.Found && page.OcrText != originalText)
            return Result<ScanOcrDto>.Fail("OCR text changed during recognition. The current text was kept.", "scanId");

        var before = string.IsNullOrWhiteSpace(page.OcrText) ? "no text" : $"{page.OcrText.Length} characters";
        if (extraction.Found) page.OcrText = extraction.Text;
        if (page.Status == PageStatus.Processing && failure is null)
        {
            var activeSibling = await db.ScanPages.AnyAsync(p =>
                p.Barcode == page.Barcode && p.PageNo == page.PageNo &&
                p.Id != page.Id && p.Status == PageStatus.Active, ct);
            page.Status = activeSibling ? PageStatus.Duplicate : PageStatus.PendingReview;
        }

        var actor = current.User?.DisplayName ?? current.UserName;
        await audit.LogAsync(
            db, AuditAction.Update, "FileScanPage", page.Id.ToString(), before,
            failure is not null ? "OCR failed; saved text kept" :
                extraction.Found ? $"{extraction.Text.Length} characters via {extraction.Method}" : "no text found; saved text kept",
            $"OCR re-run for page {page.PageNo} of {page.Barcode} by {actor}: {extraction.Method}.", ct);
        await db.SaveChangesAsync(ct);
        await audit.AnnounceAsync(RealtimeChannels.Digitization, "page.processed", page.Id.ToString(),
            $"OCR updated for page {page.PageNo} of {page.Barcode}");
        if (failure is not null) return Result<ScanOcrDto>.Fail(failure, "ocr");

        return Result<ScanOcrDto>.Ok(new ScanOcrDto(
            page.Id, page.Barcode, page.PageNo, page.Version,
            extraction.Text, extraction.Method, DateTime.UtcNow));
    }
}
