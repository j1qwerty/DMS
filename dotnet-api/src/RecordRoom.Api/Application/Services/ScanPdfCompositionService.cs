using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Auth;
using RecordRoom.Api.Infrastructure.Data;
using RecordRoom.Api.Infrastructure.Realtime;

namespace RecordRoom.Api.Application.Services;

public interface IScanPdfCompositionService
{
    Task<Result<RecordFileDocumentDto>> GenerateFinalPdfAsync(int fileId, CancellationToken ct = default);
}

/// <summary>
/// Composes the latest approved page-side scans into a versioned PDF derivative.
/// The source scan blobs are read-only and are never replaced or modified.
/// </summary>
public sealed class ScanPdfCompositionService(
    AppDbContext db,
    IPrivateDocumentStore documentStore,
    IAuditWriter audit,
    ICurrentUserAccessor current,
    ILogger<ScanPdfCompositionService> logger) : IScanPdfCompositionService
{
    private sealed record SourceManifestItem(
        long ScanId, int PageNo, string Side, int Version, string FileName,
        string ContentType, string Sha256, int? OriginalPageCount, string DocumentSize);

    private static (double WidthMm, double HeightMm) Paper(string size) =>
        size.ToUpperInvariant() switch
        {
            "A0" => (841, 1189),
            "A1" => (594, 841),
            "A2" => (420, 594),
            "A3" => (297, 420),
            "A4" => (210, 297),
            "LEGAL" => (215.9, 355.6),
            _ => (210, 297),
        };

    private static string SafeFileNumber(string value)
    {
        var safe = new string(value.Select(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_' ? ch : '_').ToArray());
        return string.IsNullOrWhiteSpace(safe) ? "DMS-File" : safe;
    }

    public async Task<Result<RecordFileDocumentDto>> GenerateFinalPdfAsync(int fileId, CancellationToken ct = default)
    {
        var file = await db.Files.AsNoTracking()
            .Where(row => row.Id == fileId)
            .Select(row => new { row.Id, row.Barcode, row.FileNumber })
            .FirstOrDefaultAsync(ct);
        if (file is null)
            return Result<RecordFileDocumentDto>.Fail("File not found.", "fileId");

        var approved = await db.ScanPages.AsNoTracking()
            .Where(page => page.Barcode == file.Barcode
                && page.Status == PageStatus.Approved
                && page.StorageKey != null
                && page.ContentType != null
                && page.Sha256 != null)
            .OrderBy(page => page.PageNo)
            .ThenBy(page => page.Side == "Back" ? 1 : 0)
            .ThenByDescending(page => page.Version)
            .ToListAsync(ct);

        // One approved source version per physical page side. If a newer
        // rescan is still awaiting review, the previously approved source stays.
        var sources = approved
            .GroupBy(page => new { page.PageNo, page.Side })
            .Select(group => group.OrderByDescending(page => page.Version).First())
            .OrderBy(page => page.PageNo)
            .ThenBy(page => page.Side == "Back" ? 1 : 0)
            .ToArray();

        if (sources.Length == 0)
            return Result<RecordFileDocumentDto>.Fail(
                "No approved scan pages with stored documents are available to compose.",
                "scans");

        using var output = new PdfDocument();
        output.Info.Title = $"Digitized record {file.FileNumber}";
        output.Info.Creator = "Document Management System";
        output.Info.Subject = $"Final digitized PDF for file {file.FileNumber}";

        var manifest = new List<SourceManifestItem>();
        var totalPages = 0;

        try
        {
            foreach (var source in sources)
            {
                ct.ThrowIfCancellationRequested();
                await using var stream = await documentStore.OpenReadAsync(source.StorageKey!, ct);
                if (stream is null)
                    return Result<RecordFileDocumentDto>.Fail(
                        $"The approved source scan '{source.FileName}' is missing from private storage.",
                        "scans");

                if (string.Equals(source.ContentType, "application/pdf", StringComparison.OrdinalIgnoreCase))
                {
                    using var imported = PdfReader.Open(stream, PdfDocumentOpenMode.Import);
                    if (imported.PageCount == 0)
                        return Result<RecordFileDocumentDto>.Fail(
                            $"The source PDF '{source.FileName}' contains no readable pages.",
                            "scans");

                    for (var index = 0; index < imported.PageCount; index++)
                        output.AddPage(imported.Pages[index]);

                    totalPages += imported.PageCount;
                }
                else if (source.ContentType is "image/jpeg" or "image/png" or "image/gif")
                {
                    using var image = XImage.FromStream(stream);
                    if (image.PixelWidth <= 0 || image.PixelHeight <= 0)
                        return Result<RecordFileDocumentDto>.Fail(
                            $"The source image '{source.FileName}' has invalid dimensions.",
                            "scans");

                    var paper = Paper(source.DocumentSize);
                    var sourceAspect = (double)image.PixelWidth / image.PixelHeight;
                    if (sourceAspect > paper.WidthMm / paper.HeightMm)
                        paper = (paper.HeightMm, paper.WidthMm);

                    var page = output.AddPage();
                    page.Width = XUnit.FromMillimeter(paper.WidthMm);
                    page.Height = XUnit.FromMillimeter(paper.HeightMm);

                    var pageWidth = page.Width.Point;
                    var pageHeight = page.Height.Point;
                    var scale = Math.Min(pageWidth / image.PixelWidth, pageHeight / image.PixelHeight);
                    var drawWidth = image.PixelWidth * scale;
                    var drawHeight = image.PixelHeight * scale;
                    var left = (pageWidth - drawWidth) / 2;
                    var top = (pageHeight - drawHeight) / 2;

                    using var graphics = XGraphics.FromPdfPage(page);
                    graphics.DrawImage(image, left, top, drawWidth, drawHeight);
                    totalPages++;
                }
                else
                {
                    return Result<RecordFileDocumentDto>.Fail(
                        $"The source scan '{source.FileName}' uses an unsupported image format.",
                        "scans");
                }

                manifest.Add(new SourceManifestItem(
                    source.Id, source.PageNo, source.Side, source.Version, source.FileName,
                    source.ContentType!, source.Sha256!, source.PageCount, source.DocumentSize));
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not compose the approved scans for file {FileId}.", fileId);
            return Result<RecordFileDocumentDto>.Fail(
                "One or more approved source scans could not be composed. Review the source file and rescan it if necessary.",
                "scans");
        }

        if (totalPages == 0 || output.PageCount == 0)
            return Result<RecordFileDocumentDto>.Fail("The final PDF contains no pages.", "scans");

        await using var pdf = new MemoryStream();
        output.Save(pdf, closeStream: false);
        pdf.Position = 0;

        var version = (await db.FileDocuments.AsNoTracking()
            .Where(document => document.RecordFileId == fileId)
            .Select(document => (int?)document.Version)
            .MaxAsync(ct) ?? 0) + 1;
        var fileName = $"{SafeFileNumber(file.FileNumber)}-FINAL-v{version:000}.pdf";
        var storedResult = await documentStore.SaveGeneratedPdfAsync(pdf, fileName, ct);
        if (!storedResult.IsSuccess)
            return Result<RecordFileDocumentDto>.Fail(storedResult.Errors);
        var stored = storedResult.Value;

        var row = new RecordFileDocument
        {
            RecordFileId = fileId,
            Version = version,
            OriginalFileName = stored.OriginalFileName,
            StorageKey = stored.StorageKey,
            ContentType = stored.ContentType,
            SizeBytes = stored.SizeBytes,
            Sha256 = stored.Sha256,
            PageCount = stored.PageCount ?? totalPages,
            DocumentKind = "FinalPdf",
            SourceManifest = JsonSerializer.Serialize(manifest),
            UploadedAt = DateTime.UtcNow,
            UploadedBy = current.UserName,
        };

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        db.FileDocuments.Add(row);
        await audit.LogAsync(db, AuditAction.Create, "RecordFileDocument", "pending",
            "no final PDF",
            $"{row.OriginalFileName}; pages={row.PageCount}; bytes={row.SizeBytes}; sha256={row.Sha256}",
            $"Generated final PDF v{version} for {file.FileNumber} from {manifest.Count} approved page-side source(s)", ct);
        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            logger.LogWarning(ex, "Could not register final PDF v{Version} for file {FileId}.", version, fileId);
            await TryDeleteAsync(stored.StorageKey);
            return Result<RecordFileDocumentDto>.Fail(
                "The final PDF could not be registered because another document version was added. Please retry.",
                "document");
        }
        catch
        {
            await TryDeleteAsync(stored.StorageKey);
            throw;
        }

        await audit.AnnounceAsync(RealtimeChannels.Files, "file.document.generated", fileId.ToString(),
            $"{row.OriginalFileName} generated from approved scans");
        return Result<RecordFileDocumentDto>.Ok(new RecordFileDocumentDto(
            row.Id, file.Id, file.Barcode, row.Version, row.OriginalFileName,
            row.ContentType, row.SizeBytes, row.Sha256, row.UploadedAt, row.UploadedBy,
            row.PageCount, row.DocumentKind));
    }

    private async Task TryDeleteAsync(string storageKey)
    {
        try { await documentStore.DeleteAsync(storageKey, CancellationToken.None); }
        catch (Exception ex)
        {
            logger.LogError(ex, "Could not clean up failed generated PDF storage key {StorageKey}.", storageKey);
        }
    }
}
