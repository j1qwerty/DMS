using Microsoft.EntityFrameworkCore;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Auth;
using RecordRoom.Api.Infrastructure.Data;
using RecordRoom.Api.Infrastructure.Imaging;

namespace RecordRoom.Api.Application.Services;

/// <summary>
/// The scan composition studio (work plan §3.4) plus the deliverable PDF
/// builder (§3.5). The studio owns everything that turns "stored scans" into
/// "digitized properly": persisted page order, replace/duplicate, rotate and
/// enhancement (the original blob is never modified — the processed copy is a
/// separate key), and the generated PDF deliverable with an invisible OCR text
/// layer where page text exists.
/// </summary>
public interface IScanStudioService
{
    /// <summary>Persists the composition order: OrderIndex follows the given scan-id sequence.</summary>
    Task<Result<FileScanPageDto[]>> ReorderAsync(int fileId, ScanOrderInput input, CancellationToken ct = default);

    /// <summary>Writes a rotated processed copy (quarter turns).</summary>
    Task<Result<FileScanPageDto>> RotateAsync(long scanId, ScanRotateInput input, CancellationToken ct = default);

    /// <summary>Applies one enhancement operation as the processed copy.</summary>
    Task<Result<FileScanPageDto>> EnhanceAsync(long scanId, ScanEnhanceInput input, CancellationToken ct = default);

    /// <summary>Drops the processed copy; the original scan becomes current again.</summary>
    Task<Result<FileScanPageDto>> RevertAsync(long scanId, CancellationToken ct = default);

    /// <summary>Streams the stored bytes: the processed copy when asked for and present.</summary>
    Task<PrivateDocumentContent?> OpenDocumentAsync(long scanId, bool processed, CancellationToken ct = default);

    /// <summary>Duplicates a page (same content, next version) for insert-before style composition.</summary>
    Task<Result<FileScanPageDto>> DuplicateAsync(long scanId, CancellationToken ct = default);

    /// <summary>Generated PDF deliverables of one file, newest first.</summary>
    Task<DocumentDerivativeDto[]> ListPdfsAsync(int fileId, CancellationToken ct = default);

    /// <summary>Builds the PDF from the file's approved pages, in composition order.</summary>
    Task<Result<DocumentDerivativeDto>> BuildPdfAsync(int fileId, DeliverablePdfInput input, CancellationToken ct = default);

    /// <summary>
    /// Round 4: reviewer sign-off on a freshly built PDF — approve the final
    /// composition, or reject it with a reason. The row and its bytes stay in
    /// the history either way.
    /// </summary>
    Task<Result<DocumentDerivativeDto>> ReviewPdfAsync(long derivativeId, DeliverableReviewInput input, CancellationToken ct = default);

    Task<PrivateDocumentContent?> OpenPdfAsync(long derivativeId, CancellationToken ct = default);
}

public sealed class ScanStudioService(
    AppDbContext db,
    IAuditWriter audit,
    ICurrentUserAccessor current,
    IPrivateDocumentStore documentStore,
    IScanEnhancer enhancer,
    IFileRefs fileRefs,
    ILogger<ScanStudioService> logger) : IScanStudioService
{
    static ScanStudioService()
    {
        QuestPDF.Settings.License = LicenseType.Community;
        // QuestPDF 2026.9 stopped reading system fonts by default, which made
        // every "Build deliverable PDF" fail on a missing "Segoe UI" family —
        // on Windows too. The deliverable's text is metadata (header, footer,
        // OCR layer), so it must render on every machine: use the deployment's
        // fonts and fall back to the first available family instead of throwing.
        QuestPDF.Settings.UseSystemFonts = true;
        QuestPDF.Settings.ThrowOnMissingFontFamilies = false;
    }

    private async Task<RecordFile?> FileByBarcodeAsync(string barcode, CancellationToken ct) =>
        await db.Files.AsNoTracking().FirstOrDefaultAsync(f => f.Barcode == barcode, ct);

    private async Task<RecordFile?> FileByIdAsync(int fileId, CancellationToken ct) =>
        await db.Files.AsNoTracking().FirstOrDefaultAsync(f => f.Id == fileId, ct);

    private FileScanPageDto ToDto(FileScanPage p, RecordFile file) => new(
        p.Id, file.Id, p.Barcode, p.FileName, p.PageNo, p.Version, p.DocumentSize,
        Display.Page(p.Status), p.Note, p.UploadedAt, p.UploadedBy,
        !string.IsNullOrWhiteSpace(p.StorageKey), p.ContentType, p.SizeBytes, p.Sha256,
        p.PageCount, p.PageIndex,
        file.FileNumber,
        p.OrderIndex, p.Dpi, p.Enhancement,
        !string.IsNullOrWhiteSpace(p.ProcessedStorageKey), p.OcrText);

    private async Task<FileScanPageDto> EnrichedAsync(FileScanPage p, CancellationToken ct)
    {
        var file = await FileByBarcodeAsync(p.Barcode, ct)
            ?? new RecordFile { Barcode = p.Barcode, FileNumber = p.Barcode, Subject = string.Empty };
        return (await fileRefs.EnrichAsync(new[] { ToDto(p, file) }, ct))[0];
    }

    public async Task<Result<FileScanPageDto[]>> ReorderAsync(int fileId, ScanOrderInput input, CancellationToken ct)
    {
        var file = await FileByIdAsync(fileId, ct);
        if (file is null) return Result<FileScanPageDto[]>.Fail("File not found.", "fileId");
        if (input.ScanIds is null || input.ScanIds.Length == 0)
            return Result<FileScanPageDto[]>.Fail("Give the page order as a list of scan ids.", "scanIds");

        var pages = await db.ScanPages
            .Where(p => p.Barcode == file.Barcode && input.ScanIds.Contains(p.Id))
            .ToListAsync(ct);

        // Every id must belong to this file — a foreign id would silently drop out.
        var known = pages.Select(p => p.Id).ToHashSet();
        var unknown = input.ScanIds.Where(id => !known.Contains(id)).ToArray();
        if (unknown.Length > 0)
            return Result<FileScanPageDto[]>.Fail(
                $"Scan id(s) {string.Join(", ", unknown)} do not belong to this file.", "scanIds");

        // Only pages listed change order; unlisted pages keep their index and
        // sit before the reordered block, so a partial drag is not a reshuffle.
        var order = 0;
        foreach (var id in input.ScanIds)
        {
            var page = pages.First(p => p.Id == id);
            page.OrderIndex = ++order;
        }

        await audit.LogAsync(db, AuditAction.Update, "FileScanPage", file.Id.ToString(),
            "composition order", $"{input.ScanIds.Length} page(s) reordered",
            $"{file.Barcode}: studio page order saved ({input.ScanIds.Length} pages)", ct);
        await db.SaveChangesAsync(ct);
        await audit.AnnounceAsync(RealtimeChannels.Digitization, "studio.reordered", file.Id.ToString(),
            $"{file.Barcode}: page order updated");

        var rows = await db.ScanPages.AsNoTracking()
            .Where(p => p.Barcode == file.Barcode)
            .OrderBy(p => p.OrderIndex).ThenBy(p => p.PageNo).ThenBy(p => p.Version)
            .ToListAsync(ct);
        return Result<FileScanPageDto[]>.Ok(
            await fileRefs.EnrichAsync(rows.Select(p => ToDto(p, file)).ToArray(), ct));
    }

    public async Task<Result<FileScanPageDto>> RotateAsync(long scanId, ScanRotateInput input, CancellationToken ct) =>
        await ProcessAsync(scanId, "rotate", input.Degrees, ct);

    public async Task<Result<FileScanPageDto>> EnhanceAsync(long scanId, ScanEnhanceInput input, CancellationToken ct) =>
        await ProcessAsync(scanId, input.Operation, null, ct);

    private async Task<Result<FileScanPageDto>> ProcessAsync(
        long scanId, string operation, int? degrees, CancellationToken ct)
    {
        var page = await db.ScanPages.FirstOrDefaultAsync(p => p.Id == scanId, ct);
        if (page is null) return Result<FileScanPageDto>.Fail("Scan page not found.", "scanId");
        if (string.IsNullOrWhiteSpace(page.StorageKey))
            return Result<FileScanPageDto>.Fail("This page has no stored scan yet.", "scanId");

        await using var source = await documentStore.OpenReadAsync(page.StorageKey, ct);
        if (source is null) return Result<FileScanPageDto>.Fail("The stored scan could not be opened.", "scanId");
        using var memory = new MemoryStream();
        await source.CopyToAsync(memory, ct);
        var bytes = memory.ToArray();

        var label = degrees is { } d ? $"rotated {d}°" : null;
        var result = await enhancer.EnhanceAsync(
            bytes, page.ContentType ?? "application/octet-stream", operation,
            (page.PageIndex ?? 1) - 1, degrees ?? 90, ct);
        if (!result.IsSuccess) return Result<FileScanPageDto>.Fail(result.Errors);
        var (processed, operationLabel) = result.Value;
        label ??= operationLabel;

        // The previous processed copy (if any) is superseded: it derives from
        // the same original, and keeping a stack of intermediates serves no
        // archival rule — the original is the provenance.
        var previousProcessed = page.ProcessedStorageKey;
        var stored = await documentStore.SaveBytesAsync(
            processed, Path.ChangeExtension(page.FileName, ".png"), "image/png", ct);
        if (!stored.IsSuccess) return Result<FileScanPageDto>.Fail(stored.Errors);

        var previousLabel = page.Enhancement;
        page.ProcessedStorageKey = stored.Value.StorageKey;
        page.Enhancement = label;
        page.ProcessedAt = DateTime.UtcNow;
        page.ProcessedBy = current.User?.DisplayName ?? current.UserName;

        await audit.LogAsync(db, AuditAction.Update, "FileScanPage", page.Id.ToString(),
            previousLabel is null ? "original" : previousLabel, label,
            $"Page {page.PageNo} of {page.Barcode}: {label} (original kept)", ct);
        await db.SaveChangesAsync(ct);
        if (!string.IsNullOrWhiteSpace(previousProcessed) && previousProcessed != page.ProcessedStorageKey)
            await TryDeleteAsync(previousProcessed);
        await audit.AnnounceAsync(RealtimeChannels.Digitization, "studio.enhanced", page.Id.ToString(),
            $"{page.FileName}: {label}");
        return Result<FileScanPageDto>.Ok(await EnrichedAsync(page, ct));
    }

    public async Task<Result<FileScanPageDto>> RevertAsync(long scanId, CancellationToken ct)
    {
        var page = await db.ScanPages.FirstOrDefaultAsync(p => p.Id == scanId, ct);
        if (page is null) return Result<FileScanPageDto>.Fail("Scan page not found.", "scanId");
        if (string.IsNullOrWhiteSpace(page.ProcessedStorageKey))
            return Result<FileScanPageDto>.Fail("This page has no processed copy to revert.", "scanId");

        var processedKey = page.ProcessedStorageKey;
        page.ProcessedStorageKey = null;
        page.Enhancement = null;
        page.ProcessedAt = null;
        page.ProcessedBy = string.Empty;

        await audit.LogAsync(db, AuditAction.Update, "FileScanPage", page.Id.ToString(),
            page.Enhancement ?? "processed", "original",
            $"Page {page.PageNo} of {page.Barcode} reverted to the original scan", ct);
        await db.SaveChangesAsync(ct);
        await TryDeleteAsync(processedKey);
        await audit.AnnounceAsync(RealtimeChannels.Digitization, "studio.reverted", page.Id.ToString(),
            $"{page.FileName}: back to the original scan");
        return Result<FileScanPageDto>.Ok(await EnrichedAsync(page, ct));
    }

    public async Task<PrivateDocumentContent?> OpenDocumentAsync(long scanId, bool processed, CancellationToken ct)
    {
        var page = await db.ScanPages.AsNoTracking().FirstOrDefaultAsync(p => p.Id == scanId, ct);
        var key = (processed && !string.IsNullOrWhiteSpace(page?.ProcessedStorageKey))
            ? page.ProcessedStorageKey
            : page?.StorageKey;
        if (page is null || key is null || page.ContentType is null || page.Sha256 is null) return null;

        // Served as an image when the processed copy is requested, whatever the
        // original format was — the enhancer always writes PNG.
        var contentType = processed && key != page.StorageKey ? "image/png" : page.ContentType;
        var fileName = contentType == "image/png" && !page.FileName.EndsWith(".png", StringComparison.OrdinalIgnoreCase)
            ? Path.ChangeExtension(page.FileName, ".png")
            : page.FileName;
        var stream = await documentStore.OpenReadAsync(key, ct);
        return stream is null ? null
            : new PrivateDocumentContent(fileName, contentType, stream.Length, page.Sha256, stream);
    }

    public async Task<Result<FileScanPageDto>> DuplicateAsync(long scanId, CancellationToken ct)
    {
        var page = await db.ScanPages.FirstOrDefaultAsync(p => p.Id == scanId, ct);
        if (page is null) return Result<FileScanPageDto>.Fail("Scan page not found.", "scanId");

        var nextVersion = (await db.ScanPages.AsNoTracking()
            .Where(p => p.Barcode == page.Barcode && p.PageNo == page.PageNo)
            .Select(p => (int?)p.Version).MaxAsync(ct) ?? 0) + 1;

        string? copiedKey = null;
        if (!string.IsNullOrWhiteSpace(page.StorageKey))
        {
            await using var source = await documentStore.OpenReadAsync(page.StorageKey, ct);
            if (source is null) return Result<FileScanPageDto>.Fail("The stored scan could not be opened.", "scanId");
            using var memory = new MemoryStream();
            await source.CopyToAsync(memory, ct);
            copiedKey = (await documentStore.SaveBytesAsync(
                memory.ToArray(), page.FileName, page.ContentType ?? "application/octet-stream", ct))
                .Value?.StorageKey;
        }

        // The duplicate takes the next composition slot so it lands "after",
        // matching the studio's insert semantics.
        var nextOrder = (await db.ScanPages.AsNoTracking()
            .Where(p => p.Barcode == page.Barcode)
            .Select(p => (int?)p.OrderIndex).MaxAsync(ct) ?? 0) + 1;

        var copy = new FileScanPage
        {
            Barcode = page.Barcode,
            FileName = page.FileName,
            PageNo = page.PageNo,
            Version = nextVersion,
            DocumentSize = page.DocumentSize,
            Status = PageStatus.PendingReview,
            Note = $"Duplicated from version {page.Version}.",
            UploadedAt = DateTime.UtcNow,
            UploadedBy = current.User?.DisplayName ?? current.UserName,
            StorageKey = copiedKey,
            ContentType = page.ContentType,
            SizeBytes = page.SizeBytes,
            Sha256 = page.Sha256,
            PageCount = page.PageCount,
            PageIndex = page.PageIndex,
            OrderIndex = nextOrder,
            Dpi = page.Dpi,
            OcrText = page.OcrText,
        };
        db.ScanPages.Add(copy);
        await audit.LogAsync(db, AuditAction.Create, "FileScanPage", "pending",
            "-", $"duplicate of v{page.Version}",
            $"Page {page.PageNo} of {page.Barcode} duplicated as version {nextVersion}", ct);
        await db.SaveChangesAsync(ct);
        await audit.AnnounceAsync(RealtimeChannels.Digitization, "studio.duplicated", copy.Id.ToString(),
            $"{copy.FileName} duplicated as version {nextVersion}");
        return Result<FileScanPageDto>.Ok(await EnrichedAsync(copy, ct));
    }

    public async Task<DocumentDerivativeDto[]> ListPdfsAsync(int fileId, CancellationToken ct)
    {
        var file = await FileByIdAsync(fileId, ct);
        if (file is null) return [];

        var rows = await db.Derivatives.AsNoTracking()
            .Where(d => d.Barcode == file.Barcode)
            .OrderByDescending(d => d.CreatedAt).ThenByDescending(d => d.Id)
            .ToListAsync(ct);
        return rows.Select(d => ToDto(d, file)).ToArray();
    }

    private static DocumentDerivativeDto ToDto(DocumentDerivative d, RecordFile file) => new(
        d.Id, file.Id, d.Barcode, d.Kind, d.FileName, d.SizeBytes, d.Sha256,
        d.PageCount, d.SourceVersions, d.IncludesOcrText, d.CreatedAt, d.CreatedBy, file.FileNumber,
        d.Status, d.ReviewedBy, d.ReviewedAt, d.ReviewNote);

    public async Task<Result<DocumentDerivativeDto>> BuildPdfAsync(int fileId, DeliverablePdfInput input, CancellationToken ct)
    {
        var file = await db.Files.AsNoTracking().FirstOrDefaultAsync(f => f.Id == fileId, ct);
        if (file is null) return Result<DocumentDerivativeDto>.Fail("File not found.", "fileId");

        // The deliverable is built from quality-verified pages only (§1.2:
        // legible, aligned, cropped output). Pending or rejected pages wait.
        var pages = await db.ScanPages.AsNoTracking()
            .Where(p => p.Barcode == file.Barcode && p.Status == PageStatus.Approved)
            .OrderBy(p => p.OrderIndex).ThenBy(p => p.PageNo).ThenBy(p => p.Version)
            .ToListAsync(ct);
        pages = [.. pages.GroupBy(p => p.PageNo).Select(g => g.OrderByDescending(p => p.Version).First())];

        var withContent = new List<FileScanPage>();
        foreach (var page in pages)
            if (!string.IsNullOrWhiteSpace(page.ProcessedStorageKey ?? page.StorageKey))
                withContent.Add(page);
        if (withContent.Count == 0)
            return Result<DocumentDerivativeDto>.Fail(
                "No approved scan pages to build from: approve pages in the review queue first.", "fileId");

        var sheets = new List<(byte[] Bytes, string? Text, string Size)>();
        foreach (var page in withContent)
        {
            var key = page.ProcessedStorageKey ?? page.StorageKey;
            await using var stream = await documentStore.OpenReadAsync(key!, ct);
            if (stream is null) continue;
            using var memory = new MemoryStream();
            await stream.CopyToAsync(memory, ct);
            sheets.Add((memory.ToArray(),
                string.IsNullOrWhiteSpace(page.OcrText) ? null : page.OcrText,
                page.DocumentSize));
        }
        if (sheets.Count == 0)
            return Result<DocumentDerivativeDto>.Fail("The approved pages' scans could not be read.", "fileId");

        var includesOcr = sheets.Any(s => !string.IsNullOrWhiteSpace(s.Text));
        byte[] pdf;
        try
        {
            pdf = Compose(file.Barcode, file.FileNumber, file.Subject, sheets);
        }
        catch (Exception ex) when (ex.Message.Contains("glyph", StringComparison.OrdinalIgnoreCase))
        {
            // The OCR text layer is invisible (the scan image covers it), so a
            // glyph gap — Hindi text on a machine without a Devanagari font —
            // must not lose the deliverable. Rebuild without the layer and
            // report it honestly instead of claiming a searchable PDF.
            logger.LogWarning(ex,
                "OCR text could not be shaped for {Barcode}; building without the text layer.", file.Barcode);
            includesOcr = false;
            pdf = Compose(file.Barcode, file.FileNumber, file.Subject, sheets, includeText: false);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "PDF composition failed for {Barcode}.", file.Barcode);
            return Result<DocumentDerivativeDto>.Fail("The deliverable PDF could not be composed.", "fileId");
        }

        var fileName = !string.IsNullOrWhiteSpace(input.FileName)
            ? input.FileName.Trim()
            : $"{file.FileNumber}-deliverable-{DateTime.UtcNow:yyyyMMdd-HHmm}.pdf";
        if (!fileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) fileName += ".pdf";

        var stored = await documentStore.SaveBytesAsync(pdf, fileName, "application/pdf", ct);
        if (!stored.IsSuccess) return Result<DocumentDerivativeDto>.Fail(stored.Errors);

        var derivative = new DocumentDerivative
        {
            Barcode = file.Barcode,
            Kind = "Pdf",
            FileName = stored.Value.OriginalFileName,
            StorageKey = stored.Value.StorageKey,
            ContentType = stored.Value.ContentType,
            SizeBytes = stored.Value.SizeBytes,
            Sha256 = stored.Value.Sha256,
            PageCount = stored.Value.PageCount ?? sheets.Count,
            SourceVersions = string.Join(", ", withContent.Select(p => $"#{p.Id}:v{p.Version}")),
            IncludesOcrText = includesOcr,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = current.User?.DisplayName ?? current.UserName,
            // Round 4: a fresh build waits for reviewer sign-off on the final
            // composition before it counts as the file's deliverable.
            Status = "Pending approval",
        };
        db.Derivatives.Add(derivative);
        await audit.LogAsync(db, AuditAction.Create, "DocumentDerivative", "pending", "-",
            $"{derivative.FileName}; pages={derivative.PageCount}; sha256={derivative.Sha256}; status=pending approval",
            $"Deliverable PDF built for {file.Barcode} from {withContent.Count} approved page(s)", ct);
        await db.SaveChangesAsync(ct);
        await audit.AnnounceAsync(RealtimeChannels.Digitization, "deliverable.built", derivative.Id.ToString(),
            $"{derivative.FileName} built for {file.Barcode}");
        return Result<DocumentDerivativeDto>.Ok(ToDto(derivative, file));
    }

    public async Task<Result<DocumentDerivativeDto>> ReviewPdfAsync(
        long derivativeId, DeliverableReviewInput input, CancellationToken ct)
    {
        var row = await db.Derivatives.FirstOrDefaultAsync(d => d.Id == derivativeId, ct);
        if (row is null) return Result<DocumentDerivativeDto>.Fail("Deliverable PDF not found.", "derivativeId");

        var decision = input.Decision?.Trim();
        if (!string.Equals(decision, "Approved", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(decision, "Rejected", StringComparison.OrdinalIgnoreCase))
            return Result<DocumentDerivativeDto>.Fail("Decision must be Approved or Rejected.", "decision");
        var normalized = string.Equals(decision, "Approved", StringComparison.OrdinalIgnoreCase)
            ? "Approved" : "Rejected";

        if (row.Status != "Pending approval")
            return Result<DocumentDerivativeDto>.Fail(
                $"This PDF was already {row.Status.ToLowerInvariant()}.", "derivativeId");

        var note = input.Note?.Trim();
        if (normalized == "Rejected" && string.IsNullOrWhiteSpace(note))
            return Result<DocumentDerivativeDto>.Fail("A rejection reason is required.", "note");

        var file = await FileByBarcodeAsync(row.Barcode, ct);
        row.Status = normalized;
        row.ReviewedBy = current.User?.DisplayName ?? current.UserName;
        row.ReviewedAt = DateTime.UtcNow;
        row.ReviewNote = string.IsNullOrWhiteSpace(note) ? null : note;

        var action = normalized == "Approved" ? AuditAction.Approve : AuditAction.Reject;
        await audit.LogAsync(db, action, "DocumentDerivative", row.Id.ToString(),
            "pending approval", normalized.ToLowerInvariant(),
            $"{row.FileName} {normalized.ToLowerInvariant()} by {row.ReviewedBy}"
                + (row.ReviewNote is null ? "" : $" — {row.ReviewNote}"), ct);
        await db.SaveChangesAsync(ct);
        await audit.AnnounceAsync(RealtimeChannels.Digitization, "deliverable.reviewed", row.Id.ToString(),
            $"{row.FileName} {normalized.ToLowerInvariant()} for {row.Barcode}");
        return Result<DocumentDerivativeDto>.Ok(ToDto(row, file ?? new RecordFile { Barcode = row.Barcode, FileNumber = row.Barcode, Subject = string.Empty }));
    }

    public async Task<PrivateDocumentContent?> OpenPdfAsync(long derivativeId, CancellationToken ct)
    {
        var row = await db.Derivatives.AsNoTracking().FirstOrDefaultAsync(d => d.Id == derivativeId, ct);
        if (row?.StorageKey is null || row.Sha256 is null) return null;
        var stream = await documentStore.OpenReadAsync(row.StorageKey, ct);
        return stream is null ? null
            : new PrivateDocumentContent(row.FileName, row.ContentType ?? "application/pdf", row.SizeBytes ?? 0, row.Sha256, stream);
    }

    /// <summary>
    /// QuestPDF composition: one page per sheet. Header names the file, the
    /// footer numbers pages, and where OCR text exists it is laid down *under*
    /// the image — fully covered, so the output reads as a scan while the text
    /// stays selectable and searchable (§3.5's invisible text layer).
    /// `includeText: false` drops that layer when the available fonts cannot
    /// shape it (e.g. Hindi OCR text without a Devanagari font); the deliverable
    /// itself must always build.
    /// </summary>
    private static byte[] Compose(
        string barcode, string fileNumber, string subject,
        IReadOnlyList<(byte[] Bytes, string? Text, string Size)> sheets,
        bool includeText = true)
    {
        return Document.Create(container =>
        {
            foreach (var (sheet, index) in sheets.Select((s, i) => (s, i)))
            {
                container.Page(page =>
                {
                    page.Size(PageSize(sheet.Size));
                    page.Margin(12);
                    page.DefaultTextStyle(x => x.FontFamily("Segoe UI").FontSize(9));

                    page.Header().Row(row =>
                    {
                        row.RelativeItem().Text($"{fileNumber} — {subject}").FontSize(9).FontColor("#555555");
                        row.ConstantItem(160).AlignRight()
                            .Text($"{barcode} · page {index + 1} of {sheets.Count}")
                            .FontSize(8).FontColor("#888888");
                    });

                    page.Content().Layers(layers =>
                    {
                        // The invisible layer first (behind), the image over it.
                        if (includeText && !string.IsNullOrWhiteSpace(sheet.Text))
                        {
                            layers.Layer().Text(sheet.Text.Trim().ReplaceLineEndings(" ")).FontSize(4);
                        }
                        layers.PrimaryLayer().Image(sheet.Bytes).FitArea();
                    });

                    page.Footer().AlignCenter().Text(text =>
                    {
                        text.Span("Page ").FontSize(8).FontColor("#888888");
                        text.CurrentPageNumber().FontSize(8).FontColor("#888888");
                        text.Span(" of ").FontSize(8).FontColor("#888888");
                        text.TotalPages().FontSize(8).FontColor("#888888");
                    });
                });
            }
        }).GeneratePdf();
    }

    /// <summary>The deliverable page matches the scanned sheet size (§1.2: A4/Legal, A3, A0/A1/A2).</summary>
    private static PageSize PageSize(string documentSize) => documentSize?.Trim().ToUpperInvariant() switch
    {
        "A3" => PageSizes.A3,
        "A2" => new PageSize(420, 594, Unit.Millimetre),
        "A1" => new PageSize(594, 841, Unit.Millimetre),
        "A0" => new PageSize(841, 1189, Unit.Millimetre),
        _ => PageSizes.A4,
    };

    private async Task TryDeleteAsync(string storageKey)
    {
        try { await documentStore.DeleteAsync(storageKey, CancellationToken.None); }
        catch (Exception ex) { logger.LogError(ex, "Could not clean up document key {StorageKey}.", storageKey); }
    }
}
