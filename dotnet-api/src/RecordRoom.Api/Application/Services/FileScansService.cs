using Microsoft.EntityFrameworkCore;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Auth;
using RecordRoom.Api.Infrastructure.Data;

namespace RecordRoom.Api.Application.Services;

/// <summary>
/// File-centric digitization (user decision 2026-10-28): every file carries its
/// own scan pages — upload a full PDF or add page-by-page scans — and the
/// Digitization section is the pending-review queue across files. The legacy
/// employee/folder batches no longer exist.
/// </summary>
public interface IFileScansService
{
    /// <summary>All scan pages of one file, every status, newest version last per page.</summary>
    Task<FileScanPageDto[]> ListByFileAsync(int fileId, CancellationToken ct = default);

    /// <summary>Registers a scanned page (metadata first; the scan image follows).</summary>
    Task<Result<FileScanPageDto>> AddAsync(int fileId, ScanAddInput input, CancellationToken ct = default);

    /// <summary>Attaches the scanned image/PDF as the next version of a page row.</summary>
    Task<Result<FileScanPageDto>> AddDocumentAsync(long scanId, Microsoft.AspNetCore.Http.IFormFile? document, CancellationToken ct = default);

    Task<PrivateDocumentContent?> OpenDocumentAsync(long scanId, CancellationToken ct = default);

    Task<ScanOcrDto?> GetOcrAsync(long scanId, CancellationToken ct = default);

    Task<Result<ScanOcrDto>> UpdateOcrAsync(long scanId, ScanOcrInput input, CancellationToken ct = default);

    Task<Result<bool>> RemoveAsync(long scanId, CancellationToken ct = default);

    Task<Result<FileScanPageDto>> ReviewAsync(long scanId, PageReviewInput input, CancellationToken ct = default);

    /// <summary>Reviews every pending page of one file at once; returns how many moved.</summary>
    Task<Result<int>> ReviewAllAsync(int fileId, PageReviewInput input, CancellationToken ct = default);

    /// <summary>The pending-review queue across all files.</summary>
    Task<FileScanPageDto[]> PendingAsync(string? search, CancellationToken ct = default);

    Task<int> PendingReviewCountAsync(CancellationToken ct = default);
}

public sealed class FileScansService(
    AppDbContext db,
    IAuditWriter audit,
    ICurrentUserAccessor current,
    IPrivateDocumentStore documentStore,
    IFileRefs fileRefs,
    ILogger<FileScansService> logger) : IFileScansService
{
    private static readonly string[] DocumentSizes = ["A0", "A1", "A2", "A3", "A4", "Legal", "Other"];

    private static FileScanPageDto ToPage(FileScanPage p, int fileId) => new(
        p.Id, fileId, p.Barcode, p.FileName, p.PageNo, p.Version, p.DocumentSize,
        Display.Page(p.Status), p.Note, p.UploadedAt, p.UploadedBy,
        !string.IsNullOrWhiteSpace(p.StorageKey), p.ContentType, p.SizeBytes, p.Sha256,
        p.PageCount, p.PageIndex, Side: p.Side,
        OcrStatus: p.OcrStatus, HasOcrText: p.OcrText is not null,
        OcrLanguage: p.OcrLanguage, OcrEngine: p.OcrEngine,
        OcrUpdatedAt: p.OcrUpdatedAt, OcrUpdatedBy: p.OcrUpdatedBy);

    public async Task<FileScanPageDto[]> ListByFileAsync(int fileId, CancellationToken ct = default)
    {
        var file = await db.Files.AsNoTracking().FirstOrDefaultAsync(f => f.Id == fileId, ct);
        if (file is null) return [];

        var rows = await db.ScanPages.AsNoTracking()
            .Where(p => p.Barcode == file.Barcode)
            .OrderBy(p => p.PageNo).ThenBy(p => p.Side).ThenBy(p => p.Version)
            .ToListAsync(ct);
        return await fileRefs.EnrichAsync(rows.Select(p => ToPage(p, fileId)).ToArray(), ct);
    }

    public async Task<Result<FileScanPageDto>> AddAsync(int fileId, ScanAddInput input, CancellationToken ct)
    {
        var file = await db.Files.FirstOrDefaultAsync(f => f.Id == fileId, ct);
        if (file is null) return Result<FileScanPageDto>.Fail("File not found.", "fileId");
        if (input.PageNo < 1) return Result<FileScanPageDto>.Fail("Page number starts at 1.", "pageNo");

        var requestedSize = string.IsNullOrWhiteSpace(input.DocumentSize)
            ? file.DocumentSize
            : input.DocumentSize.Trim();
        var size = DocumentSizes.FirstOrDefault(candidate =>
            candidate.Equals(requestedSize, StringComparison.OrdinalIgnoreCase));
        if (size is null)
            return Result<FileScanPageDto>.Fail("Choose one of A0, A1, A2, A3, A4, Legal or Other.", "documentSize");

        var side = string.IsNullOrWhiteSpace(input.Side) ? "Front" : input.Side.Trim();
        if (!side.Equals("Front", StringComparison.OrdinalIgnoreCase)
            && !side.Equals("Back", StringComparison.OrdinalIgnoreCase))
            return Result<FileScanPageDto>.Fail("Choose Front or Back for the scanned page side.", "side");
        side = side.Equals("Back", StringComparison.OrdinalIgnoreCase) ? "Back" : "Front";

        // Page number + side forms the physical page identity. Rescans version
        // independently on each side, so front and back never collide.
        var nextVersion = await db.ScanPages
            .Where(p => p.Barcode == file.Barcode && p.PageNo == input.PageNo && p.Side == side)
            .Select(p => (int?)p.Version)
            .MaxAsync(ct) ?? 0;
        nextVersion += 1;

        var hasActive = await db.ScanPages.AnyAsync(
            p => p.Barcode == file.Barcode && p.PageNo == input.PageNo
                && p.Side == side && p.Status == PageStatus.Active, ct);

        var page = new FileScanPage
        {
            Barcode = file.Barcode,
            FileName = string.IsNullOrWhiteSpace(input.FileName)
                ? $"{file.Barcode}-FILE-{input.PageNo}{(nextVersion > 1 ? $"-V{nextVersion}" : string.Empty)}.pdf"
                : input.FileName.Trim(),
            PageNo = input.PageNo,
            Side = side,
            Version = nextVersion,
            DocumentSize = size,
            Status = nextVersion > 1 && hasActive ? PageStatus.Duplicate : PageStatus.PendingReview,
            Note = nextVersion > 1 ? $"Rescan of an existing page (previous version {nextVersion - 1})." : string.Empty,
            UploadedAt = DateTime.UtcNow,
            UploadedBy = current.UserName,
        };

        db.ScanPages.Add(page);
        await audit.LogAsync(db, AuditAction.Create, "FileScanPage", "pending",
            "-", $"{page.FileName} v{page.Version}",
            $"Page {page.PageNo} of {file.Barcode} added");
        await db.SaveChangesAsync(ct);
        await audit.AnnounceAsync(RealtimeChannels.Digitization, "page.added", page.Id.ToString(),
            $"{page.FileName} added to {file.Barcode}");

        return Result<FileScanPageDto>.Ok((await fileRefs.EnrichAsync(new[] { ToPage(page, fileId) }, ct))[0]);
    }

    public async Task<Result<FileScanPageDto>> AddDocumentAsync(
        long scanId, Microsoft.AspNetCore.Http.IFormFile? document, CancellationToken ct = default)
    {
        var page = await db.ScanPages.FirstOrDefaultAsync(p => p.Id == scanId, ct);
        if (page is null) return Result<FileScanPageDto>.Fail("Scan page not found.", "scanId");

        var storedResult = await documentStore.SaveAsync(document, ct);
        if (!storedResult.IsSuccess) return Result<FileScanPageDto>.Fail(storedResult.Errors);
        var stored = storedResult.Value;

        // A metadata-only registration is filled in place: registering the page
        // and attaching its scan is one page, not two versions. Attaching a
        // document to a row that already has one is a rescan and becomes the
        // next version.
        if (page.StorageKey is null)
        {
            var beforeFile = page.FileName;
            page.FileName = stored.OriginalFileName;
            page.StorageKey = stored.StorageKey;
            page.ContentType = stored.ContentType;
            page.SizeBytes = stored.SizeBytes;
            page.Sha256 = stored.Sha256;
            page.PageCount = stored.PageCount;
            await audit.LogAsync(db, AuditAction.Update, "FileScanPage", page.Id.ToString(),
                beforeFile,
                $"{stored.OriginalFileName}; bytes={stored.SizeBytes}; sha256={stored.Sha256}",
                $"Attached scan for page {page.PageNo} of {page.Barcode}", ct);
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException ex)
            {
                logger.LogWarning(ex, "Could not attach document to scan {ScanId}.", scanId);
                await TryDeleteAsync(stored.StorageKey);
                return Result<FileScanPageDto>.Fail("This page was updated by another upload. Please retry.", "document");
            }
            catch { await TryDeleteAsync(stored.StorageKey); throw; }
            await audit.AnnounceAsync(RealtimeChannels.Digitization, "page.added", page.Id.ToString(),
                $"{stored.OriginalFileName} attached to {page.Barcode} page {page.PageNo}");
            var fileForRow = await db.Files.AsNoTracking().FirstAsync(f => f.Barcode == page.Barcode, ct);
            return Result<FileScanPageDto>.Ok(
                (await fileRefs.EnrichAsync(new[] { ToPage(page, fileForRow.Id) }, ct))[0]);
        }

        var version = (await db.ScanPages.AsNoTracking()
            .Where(p => p.Barcode == page.Barcode && p.PageNo == page.PageNo && p.Side == page.Side)
            .Select(p => (int?)p.Version).MaxAsync(ct) ?? 0) + 1;
        var hasActive = await db.ScanPages.AnyAsync(p =>
            p.Barcode == page.Barcode && p.PageNo == page.PageNo
                && p.Side == page.Side && p.Status == PageStatus.Active, ct);
        var rescan = new FileScanPage
        {
            Barcode = page.Barcode, FileName = stored.OriginalFileName,
            PageNo = page.PageNo, Side = page.Side, Version = version, DocumentSize = page.DocumentSize,
            Status = version > 1 && hasActive ? PageStatus.Duplicate : PageStatus.PendingReview,
            Note = $"Uploaded document version {version} for page {page.PageNo}.",
            UploadedAt = DateTime.UtcNow, UploadedBy = current.UserName,
            StorageKey = stored.StorageKey, ContentType = stored.ContentType, SizeBytes = stored.SizeBytes, Sha256 = stored.Sha256,
            PageCount = stored.PageCount
        };
        db.ScanPages.Add(rescan);
        await audit.LogAsync(db, AuditAction.Create, "FileScanPage", "pending",
            $"page={page.PageNo}; version={version - 1}",
            $"{stored.OriginalFileName}; version={version}; bytes={stored.SizeBytes}; sha256={stored.Sha256}",
            $"Uploaded {stored.OriginalFileName} as version {version} for {page.Barcode}", ct);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex)
        {
            logger.LogWarning(ex, "Could not register document version {Version} for scan {ScanId}.", version, scanId);
            await TryDeleteAsync(stored.StorageKey);
            return Result<FileScanPageDto>.Fail("This page was updated by another upload. Please retry.", "document");
        }
        catch { await TryDeleteAsync(stored.StorageKey); throw; }
        await audit.AnnounceAsync(RealtimeChannels.Digitization, "page.added", rescan.Id.ToString(),
            $"{stored.OriginalFileName} added as version {version}");
        var fileId = await db.Files.AsNoTracking().Where(f => f.Barcode == page.Barcode)
            .Select(f => (int?)f.Id).FirstOrDefaultAsync(ct) ?? 0;
        return Result<FileScanPageDto>.Ok((await fileRefs.EnrichAsync(new[] { ToPage(rescan, fileId) }, ct))[0]);
    }

    public async Task<PrivateDocumentContent?> OpenDocumentAsync(long scanId, CancellationToken ct = default)
    {
        var page = await db.ScanPages.AsNoTracking().FirstOrDefaultAsync(p => p.Id == scanId, ct);
        if (page?.StorageKey is null || page.ContentType is null || page.Sha256 is null) return null;
        var stream = await documentStore.OpenReadAsync(page.StorageKey, ct);
        if (stream is null) return null;

        await audit.LogAsync(db, AuditAction.Access, "FileScanPage", page.Id.ToString(),
            "not accessed", $"opened version {page.Version}",
            $"Viewed scan {page.FileName} v{page.Version} for {page.Barcode}", ct);
        await db.SaveChangesAsync(ct);
        return new PrivateDocumentContent(page.FileName, page.ContentType, page.SizeBytes ?? 0, page.Sha256, stream);
    }

    public async Task<ScanOcrDto?> GetOcrAsync(long scanId, CancellationToken ct = default)
    {
        var row = await db.ScanPages.AsNoTracking()
            .Where(page => page.Id == scanId)
            .Select(page => new
            {
                page.Id,
                page.Barcode,
                page.PageNo,
                page.Side,
                page.Version,
                page.OcrStatus,
                page.OcrText,
                page.OcrLanguage,
                page.OcrEngine,
                page.OcrError,
                page.OcrUpdatedAt,
                page.OcrUpdatedBy,
            })
            .FirstOrDefaultAsync(ct);
        if (row is null) return null;

        await audit.LogAsync(db, AuditAction.Access, "FileScanPageOcr", row.Id.ToString(),
            "not accessed", $"viewed OCR result; status={row.OcrStatus}; chars={row.OcrText?.Length ?? 0}",
            $"Viewed OCR text for file {row.Barcode} page {row.PageNo} {row.Side} v{row.Version}.", ct);
        await db.SaveChangesAsync(ct);

        var fileId = await db.Files.AsNoTracking()
            .Where(file => file.Barcode == row.Barcode)
            .Select(file => (int?)file.Id)
            .FirstOrDefaultAsync(ct) ?? 0;
        return new ScanOcrDto(
            row.Id, fileId, row.PageNo, row.Side, row.Version, row.OcrStatus,
            row.OcrText ?? string.Empty, row.OcrLanguage, row.OcrEngine,
            row.OcrError, row.OcrUpdatedAt, row.OcrUpdatedBy);
    }

    public async Task<Result<ScanOcrDto>> UpdateOcrAsync(
        long scanId, ScanOcrInput input, CancellationToken ct = default)
    {
        const int maxTextLength = 250_000;
        var page = await db.ScanPages.FirstOrDefaultAsync(row => row.Id == scanId, ct);
        if (page is null) return Result<ScanOcrDto>.Fail("Scan page not found.", "scanId");
        if (string.IsNullOrWhiteSpace(page.StorageKey))
            return Result<ScanOcrDto>.Fail("Upload the scanned PDF or image before attaching OCR text.", "document");

        var status = input.Status?.Trim();
        var completed = string.Equals(status, "Completed", StringComparison.OrdinalIgnoreCase);
        var failed = string.Equals(status, "Failed", StringComparison.OrdinalIgnoreCase);
        if (!completed && !failed)
            return Result<ScanOcrDto>.Fail("OCR status must be Completed or Failed.", "status");

        var text = input.Text ?? string.Empty;
        if (text.Length > maxTextLength)
            return Result<ScanOcrDto>.Fail("OCR text cannot exceed 250,000 characters for one scan page.", "text");
        var language = input.Language?.Trim();
        var engine = input.Engine?.Trim();
        var error = input.Error?.Trim();
        if ((language?.Length ?? 0) > 24)
            return Result<ScanOcrDto>.Fail("OCR language cannot exceed 24 characters.", "language");
        if ((engine?.Length ?? 0) > 64)
            return Result<ScanOcrDto>.Fail("OCR engine identifier cannot exceed 64 characters.", "engine");
        if ((error?.Length ?? 0) > 400)
            return Result<ScanOcrDto>.Fail("OCR error cannot exceed 400 characters.", "error");
        if (failed && string.IsNullOrWhiteSpace(error))
            return Result<ScanOcrDto>.Fail("A failure reason is required when OCR status is Failed.", "error");

        // Preserve line breaks/tabs while removing control characters that make
        // full-text indexing and export pipelines unstable.
        text = text.Replace("\r\n", "\n").Replace('\r', '\n');
        text = new string(text.Where(ch => ch == '\n' || ch == '\t' || !char.IsControl(ch)).ToArray());

        var previous = page.OcrStatus + "; chars=" + (page.OcrText?.Length ?? 0);
        page.OcrStatus = completed ? "Completed" : "Failed";
        // A failed retry must not destroy the last successful extraction text.
        // Search excludes it while status is Failed; a later successful retry
        // replaces it and restores Completed status.
        if (completed) page.OcrText = text;
        page.OcrLanguage = string.IsNullOrWhiteSpace(language) ? null : language;
        page.OcrEngine = string.IsNullOrWhiteSpace(engine) ? null : engine;
        page.OcrError = failed ? error : null;
        page.OcrUpdatedAt = DateTime.UtcNow;
        page.OcrUpdatedBy = current.UserName;

        var after = page.OcrStatus + "; chars=" + (page.OcrText?.Length ?? 0)
            + "; language=" + (page.OcrLanguage ?? "unspecified")
            + "; engine=" + (page.OcrEngine ?? "unspecified");
        var summary = "OCR " + page.OcrStatus.ToLowerInvariant() + " for scan "
            + page.Id + " (" + page.Barcode + " page " + page.PageNo + " " + page.Side + "); "
            + (page.OcrText?.Length ?? 0) + " characters.";
        await audit.LogAsync(db, AuditAction.Update, "FileScanPageOcr", page.Id.ToString(),
            previous, after, summary, ct);
        await db.SaveChangesAsync(ct);
        await audit.AnnounceAsync(RealtimeChannels.Digitization, "scan.ocr-updated",
            page.Id.ToString(), "OCR " + page.OcrStatus.ToLowerInvariant()
                + " for file " + page.Barcode + " page " + page.PageNo + ".");
        var fileId = await db.Files.AsNoTracking().Where(file => file.Barcode == page.Barcode)
            .Select(file => (int?)file.Id).FirstOrDefaultAsync(ct) ?? 0;
        return Result<ScanOcrDto>.Ok(new ScanOcrDto(
            page.Id, fileId, page.PageNo, page.Side, page.Version, page.OcrStatus,
            page.OcrText ?? string.Empty, page.OcrLanguage, page.OcrEngine,
            page.OcrError, page.OcrUpdatedAt, page.OcrUpdatedBy));
    }

    private async Task TryDeleteAsync(string storageKey)
    {
        try { await documentStore.DeleteAsync(storageKey, CancellationToken.None); }
        catch (Exception ex) { logger.LogError(ex, "Could not clean up document key {StorageKey}.", storageKey); }
    }

    public async Task<Result<bool>> RemoveAsync(long scanId, CancellationToken ct)
    {
        var page = await db.ScanPages.FirstOrDefaultAsync(p => p.Id == scanId, ct);
        if (page is null) return Result<bool>.Fail("Scan page not found.", "scanId");
        if (page.Status == PageStatus.Approved && !current.IsInRole(Role.Admin))
            return Result<bool>.Fail("Approved scans can only be removed by an admin.", "scanId");

        var storageKey = page.StorageKey;
        db.ScanPages.Remove(page);
        await audit.LogAsync(db, AuditAction.Delete, "FileScanPage", scanId.ToString(),
            $"{page.FileName} v{page.Version}", "deleted",
            $"Page {page.PageNo} scan removed from {page.Barcode}");
        await db.SaveChangesAsync(ct);
        if (!string.IsNullOrWhiteSpace(storageKey)) await TryDeleteAsync(storageKey);
        await audit.AnnounceAsync(RealtimeChannels.Digitization, "page.removed", scanId.ToString(),
            $"{page.FileName} removed from {page.Barcode}");
        return Result<bool>.Ok(true);
    }

    public async Task<Result<FileScanPageDto>> ReviewAsync(long scanId, PageReviewInput input, CancellationToken ct)
    {
        var page = await db.ScanPages.FirstOrDefaultAsync(p => p.Id == scanId, ct);
        if (page is null) return Result<FileScanPageDto>.Fail("Scan page not found.", "scanId");

        var decision = input.Decision?.Trim();
        var approve = string.Equals(decision, "Approved", StringComparison.OrdinalIgnoreCase);
        var reject = string.Equals(decision, "Rejected", StringComparison.OrdinalIgnoreCase);
        if (!approve && !reject)
            return Result<FileScanPageDto>.Fail("Choose Approved or Rejected.", "decision");
        if (reject && string.IsNullOrWhiteSpace(input.Note))
            return Result<FileScanPageDto>.Fail("A rejection reason is required.", "note");
        if (approve && (string.IsNullOrWhiteSpace(page.StorageKey)
            || string.IsNullOrWhiteSpace(page.ContentType)
            || string.IsNullOrWhiteSpace(page.Sha256)))
            return Result<FileScanPageDto>.Fail(
                "Upload the scanned PDF or image before approving this page.",
                "document");

        var before = Display.Page(page.Status);
        page.Status = approve ? PageStatus.Approved : PageStatus.Rejected;
        if (!string.IsNullOrWhiteSpace(input.Note)) page.Note = input.Note.Trim();

        var fileId = await db.Files.Where(f => f.Barcode == page.Barcode).Select(f => (int?)f.Id).FirstOrDefaultAsync(ct) ?? 0;
        await audit.LogAsync(db, approve ? AuditAction.Approve : AuditAction.Reject,
            "FileScanPage", scanId.ToString(), $"status={before}", $"status={Display.Page(page.Status)}",
            $"{page.FileName} {Display.Page(page.Status).ToLower()}");
        await db.SaveChangesAsync(ct);
        await audit.AnnounceAsync(RealtimeChannels.Digitization,
            approve ? "page.approved" : "page.rejected", scanId.ToString(),
            $"{page.FileName} {Display.Page(page.Status).ToLower()}");

        return Result<FileScanPageDto>.Ok((await fileRefs.EnrichAsync(new[] { ToPage(page, fileId) }, ct))[0]);
    }

    public async Task<Result<int>> ReviewAllAsync(int fileId, PageReviewInput input, CancellationToken ct)
    {
        var file = await db.Files.FirstOrDefaultAsync(f => f.Id == fileId, ct);
        if (file is null) return Result<int>.Fail("File not found.", "fileId");

        var decision = input.Decision?.Trim();
        var approve = string.Equals(decision, "Approved", StringComparison.OrdinalIgnoreCase);
        var reject = string.Equals(decision, "Rejected", StringComparison.OrdinalIgnoreCase);
        if (!approve && !reject)
            return Result<int>.Fail("Choose Approved or Rejected.", "decision");
        if (reject && string.IsNullOrWhiteSpace(input.Note))
            return Result<int>.Fail("A rejection reason is required.", "note");

        var pending = await db.ScanPages
            .Where(p => p.Barcode == file.Barcode && p.Status == PageStatus.PendingReview)
            .ToListAsync(ct);
        if (pending.Count == 0)
            return Result<int>.Fail("No pages are awaiting review.", "fileId");

        // Bulk approval is atomic at the application level: never approve a
        // queue containing metadata-only rows whose scan bytes were not uploaded.
        if (approve && pending.Any(page =>
            string.IsNullOrWhiteSpace(page.StorageKey)
            || string.IsNullOrWhiteSpace(page.ContentType)
            || string.IsNullOrWhiteSpace(page.Sha256)))
            return Result<int>.Fail(
                "Upload the scanned PDF or image for every pending page before bulk approval.",
                "document");

        foreach (var page in pending)
        {
            page.Status = approve ? PageStatus.Approved : PageStatus.Rejected;
            if (!string.IsNullOrWhiteSpace(input.Note)) page.Note = input.Note.Trim();
        }

        await audit.LogAsync(db, approve ? AuditAction.Approve : AuditAction.Reject,
            "FileScanPage", file.Id.ToString(),
            $"pending={pending.Count}",
            $"{(approve ? "approved" : "rejected")}={pending.Count}",
            $"{file.Barcode}: {pending.Count} page(s) {(approve ? "approved" : "rejected")}");
        await db.SaveChangesAsync(ct);
        await audit.AnnounceAsync(RealtimeChannels.Digitization,
            approve ? "page.approved" : "page.rejected", file.Id.ToString(),
            $"{file.Barcode}: {pending.Count} page(s) {(approve ? "approved" : "rejected")}");

        return Result<int>.Ok(pending.Count);
    }

    public async Task<FileScanPageDto[]> PendingAsync(string? search, CancellationToken ct = default)
    {
        var query = db.ScanPages.AsNoTracking()
            .Where(p => p.Status == PageStatus.PendingReview)
            .OrderByDescending(p => p.UploadedAt).AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            // D1: no LOWER(column) in the predicate — identity columns match as
            // a prefix, the free-text subject stays substring.
            var needle = search.Trim();
            var byNumber = db.Files.Where(f => f.FileNumber.StartsWith(needle)).Select(f => f.Barcode);
            query = query.Where(p =>
                p.Barcode.StartsWith(needle)
                || p.FileName.Contains(needle)
                || byNumber.Contains(p.Barcode));
        }

        var rows = await query.Take(200).ToListAsync(ct);
        var fileIds = await db.Files.AsNoTracking()
            .Where(f => rows.Select(r => r.Barcode).Contains(f.Barcode))
            .ToDictionaryAsync(f => f.Barcode, f => f.Id, StringComparer.OrdinalIgnoreCase, ct);
        return await fileRefs.EnrichAsync(
            rows.Select(p => ToPage(p, fileIds.GetValueOrDefault(p.Barcode, 0))).ToArray(), ct);
    }

    public async Task<int> PendingReviewCountAsync(CancellationToken ct = default) =>
        await db.ScanPages.CountAsync(p => p.Status == PageStatus.PendingReview, ct);
}
