using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Auth;
using RecordRoom.Api.Infrastructure.Data;
using RecordRoom.Api.Infrastructure.Realtime;

namespace RecordRoom.Api.Application.Services;

public interface IDigitalHandoverService
{
    Task<DigitalHandoverBatchDto[]> ListAsync(CancellationToken ct = default);
    Task<DigitalHandoverBatchDto?> GetAsync(long id, CancellationToken ct = default);
    Task<Result<DigitalHandoverBatchDto>> PrepareAsync(DigitalHandoverPrepareInput input, CancellationToken ct = default);
    Task<Result<DigitalHandoverBatchDto>> MarkDeliveredAsync(long id, CancellationToken ct = default);
    Task<Result<DigitalHandoverBatchDto>> SignOffAsync(long id, DigitalHandoverSignOffInput input, CancellationToken ct = default);
    Task<Result<DigitalHandoverPackage>> BuildPackageAsync(long id, CancellationToken ct = default);
}

/// <summary>
/// Creates immutable manifests and receiver acceptance records for digital
/// deliverables. A handover only includes versioned, approved final PDFs; the
/// item rows preserve the exact source document IDs and checksums even if the
/// registry is subsequently edited.
/// </summary>
public sealed class DigitalHandoverService(
    AppDbContext db,
    IPrivateDocumentStore documentStore,
    IAuditWriter audit,
    ICurrentUserAccessor current) : IDigitalHandoverService
{
    private const int MaxFilesPerBatch = 100;

    private static DigitalHandoverItemDto ToItemDto(DigitalHandoverItem item) => new(
        item.Id, item.RecordFileId, item.RecordFileDocumentId, item.FileNumber, item.Department,
        item.FileName, item.Version, item.ContentType, item.SizeBytes, item.PageCount, item.Sha256);

    private static DigitalHandoverBatchDto ToDto(DigitalHandoverBatch batch) => new(
        batch.Id, batch.BatchRef, batch.Department, batch.Notes, batch.Status,
        batch.ManifestSha256, batch.Items.Count, batch.PreparedBy, batch.PreparedAt,
        batch.DeliveredBy, batch.DeliveredAt, batch.AcceptedBy, batch.AcceptedAt,
        batch.DecisionNotes, batch.Items.OrderBy(x => x.FileNumber, StringComparer.OrdinalIgnoreCase)
            .Select(ToItemDto).ToArray());

    public async Task<DigitalHandoverBatchDto[]> ListAsync(CancellationToken ct = default)
    {
        var rows = await db.DigitalHandoverBatches.AsNoTracking()
            .Include(batch => batch.Items)
            .OrderByDescending(batch => batch.PreparedAt)
            .ThenByDescending(batch => batch.Id)
            .Take(100)
            .ToListAsync(ct);
        return rows.Select(ToDto).ToArray();
    }

    public async Task<DigitalHandoverBatchDto?> GetAsync(long id, CancellationToken ct = default)
    {
        var batch = await db.DigitalHandoverBatches.AsNoTracking()
            .Include(row => row.Items)
            .FirstOrDefaultAsync(row => row.Id == id, ct);
        return batch is null ? null : ToDto(batch);
    }

    public async Task<Result<DigitalHandoverBatchDto>> PrepareAsync(
        DigitalHandoverPrepareInput input, CancellationToken ct = default)
    {
        var batchRef = input.BatchRef?.Trim() ?? string.Empty;
        var department = input.Department?.Trim() ?? string.Empty;
        if (batchRef.Length == 0 || batchRef.Length > 64)
            return Result<DigitalHandoverBatchDto>.Fail("Enter a batch reference (1–64 characters).", "batchRef");
        if (department.Length == 0 || department.Length > 128)
            return Result<DigitalHandoverBatchDto>.Fail("Department is required (maximum 128 characters).", "department");
        if (input.FileIds is null || input.FileIds.Length == 0)
            return Result<DigitalHandoverBatchDto>.Fail("Select at least one file for the digital handover.", "fileIds");

        var fileIds = input.FileIds.Distinct().ToArray();
        if (fileIds.Length != input.FileIds.Length)
            return Result<DigitalHandoverBatchDto>.Fail("A file can only appear once in a handover batch.", "fileIds");
        if (fileIds.Length > MaxFilesPerBatch)
            return Result<DigitalHandoverBatchDto>.Fail($"A handover batch is limited to {MaxFilesPerBatch} files.", "fileIds");
        if (await db.DigitalHandoverBatches.AnyAsync(row => row.BatchRef == batchRef, ct))
            return Result<DigitalHandoverBatchDto>.Fail("That handover batch reference already exists.", "batchRef");

        var fileRows = await db.Files.AsNoTracking()
            .Where(file => fileIds.Contains(file.Id))
            .Select(file => new { file.Id, file.FileNumber, file.Department })
            .ToListAsync(ct);
        if (fileRows.Count != fileIds.Length)
            return Result<DigitalHandoverBatchDto>.Fail("One or more selected files no longer exist.", "fileIds");

        var preparedItems = new List<DigitalHandoverItem>();
        foreach (var file in fileRows.OrderBy(file => file.FileNumber, StringComparer.OrdinalIgnoreCase))
        {
            var document = await db.FileDocuments.AsNoTracking()
                .Where(row => row.RecordFileId == file.Id && row.DocumentKind == "FinalPdf")
                .OrderByDescending(row => row.Version)
                .FirstOrDefaultAsync(ct);
            if (document is null || !string.Equals(document.ContentType, "application/pdf", StringComparison.OrdinalIgnoreCase))
                return Result<DigitalHandoverBatchDto>.Fail(
                    $"File {file.FileNumber} does not have a generated final PDF. Generate and approve its final PDF before preparing handover.",
                    "fileIds");

            await using var stored = await documentStore.OpenReadAsync(document.StorageKey, ct);
            if (stored is null)
                return Result<DigitalHandoverBatchDto>.Fail(
                    $"The final PDF for file {file.FileNumber} is missing from private storage.",
                    "fileIds");

            preparedItems.Add(new DigitalHandoverItem
            {
                RecordFileId = file.Id,
                RecordFileDocumentId = document.Id,
                FileNumber = file.FileNumber,
                Department = file.Department,
                FileName = document.OriginalFileName,
                Version = document.Version,
                ContentType = document.ContentType,
                SizeBytes = document.SizeBytes,
                PageCount = document.PageCount,
                Sha256 = document.Sha256,
            });
        }

        var preparedAt = DateTime.UtcNow;
        var manifestItems = preparedItems.Select(item => new
        {
            item.RecordFileId,
            item.RecordFileDocumentId,
            item.FileNumber,
            item.Department,
            item.FileName,
            item.Version,
            item.ContentType,
            item.SizeBytes,
            item.PageCount,
            item.Sha256,
        }).ToArray();
        var manifestJson = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            batchRef,
            department,
            preparedAt,
            preparedBy = current.User?.DisplayName ?? current.UserName,
            files = manifestItems,
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var manifestHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(manifestJson)));

        var batch = new DigitalHandoverBatch
        {
            BatchRef = batchRef,
            Department = department,
            Notes = input.Notes?.Trim() ?? string.Empty,
            Status = "Prepared",
            ManifestJson = manifestJson,
            ManifestSha256 = manifestHash,
            PreparedBy = current.User?.DisplayName ?? current.UserName,
            PreparedAt = preparedAt,
            Items = preparedItems,
        };

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        db.DigitalHandoverBatches.Add(batch);
        await audit.LogAsync(db, AuditAction.Create, "DigitalHandoverBatch", "pending",
            "-", $"prepared; files={preparedItems.Count}; manifest={manifestHash}",
            $"Prepared digital handover {batchRef} for {department} with {preparedItems.Count} final PDF(s).", ct);
        try
        {
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(ct);
            return Result<DigitalHandoverBatchDto>.Fail(
                "The handover batch could not be saved. Check the batch reference and retry.", "batchRef");
        }

        await audit.AnnounceAsync(RealtimeChannels.Digitization, "digital-handover.prepared",
            batch.Id.ToString(), $"Digital handover {batch.BatchRef} prepared.");
        return Result<DigitalHandoverBatchDto>.Ok(ToDto(batch));
    }

    public async Task<Result<DigitalHandoverBatchDto>> MarkDeliveredAsync(long id, CancellationToken ct = default)
    {
        var batch = await db.DigitalHandoverBatches.Include(row => row.Items)
            .FirstOrDefaultAsync(row => row.Id == id, ct);
        if (batch is null) return Result<DigitalHandoverBatchDto>.Fail("Digital handover batch not found.");
        if (batch.Status != "Prepared")
            return Result<DigitalHandoverBatchDto>.Fail("Only a prepared handover can be marked delivered.", "status");

        foreach (var item in batch.Items)
        {
            var document = await db.FileDocuments.AsNoTracking()
                .FirstOrDefaultAsync(row => row.Id == item.RecordFileDocumentId, ct);
            if (document is null || document.Sha256 != item.Sha256 || document.SizeBytes != item.SizeBytes)
                return Result<DigitalHandoverBatchDto>.Fail(
                    $"The final PDF for file {item.FileNumber} no longer matches the prepared manifest.",
                    "manifest");
            await using var stored = await documentStore.OpenReadAsync(document.StorageKey, ct);
            if (stored is null)
                return Result<DigitalHandoverBatchDto>.Fail(
                    $"The final PDF for file {item.FileNumber} is missing from private storage.",
                    "manifest");
        }

        batch.Status = "Delivered";
        batch.DeliveredBy = current.User?.DisplayName ?? current.UserName;
        batch.DeliveredAt = DateTime.UtcNow;
        await audit.LogAsync(db, AuditAction.Update, "DigitalHandoverBatch", batch.Id.ToString(),
            "Prepared", $"Delivered; by={batch.DeliveredBy}; manifest={batch.ManifestSha256}",
            $"Digital handover {batch.BatchRef} marked delivered to {batch.Department}.", ct);
        await db.SaveChangesAsync(ct);
        await audit.AnnounceAsync(RealtimeChannels.Digitization, "digital-handover.delivered",
            batch.Id.ToString(), $"Digital handover {batch.BatchRef} delivered.");
        return Result<DigitalHandoverBatchDto>.Ok(ToDto(batch));
    }

    public async Task<Result<DigitalHandoverBatchDto>> SignOffAsync(
        long id, DigitalHandoverSignOffInput input, CancellationToken ct = default)
    {
        var batch = await db.DigitalHandoverBatches.Include(row => row.Items)
            .FirstOrDefaultAsync(row => row.Id == id, ct);
        if (batch is null) return Result<DigitalHandoverBatchDto>.Fail("Digital handover batch not found.");
        if (batch.Status != "Delivered")
            return Result<DigitalHandoverBatchDto>.Fail("The handover must be delivered before Department sign-off.", "status");

        var decision = input.Decision?.Trim();
        var accepted = string.Equals(decision, "Accepted", StringComparison.OrdinalIgnoreCase);
        var rejected = string.Equals(decision, "Rejected", StringComparison.OrdinalIgnoreCase);
        if (!accepted && !rejected)
            return Result<DigitalHandoverBatchDto>.Fail("Decision must be Accepted or Rejected.", "decision");
        var signer = input.SignedOffBy?.Trim() ?? string.Empty;
        if (signer.Length == 0 || signer.Length > 128)
            return Result<DigitalHandoverBatchDto>.Fail("Enter the receiving department representative's name.", "signedOffBy");
        var notes = input.Notes?.Trim() ?? string.Empty;
        if (rejected && notes.Length == 0)
            return Result<DigitalHandoverBatchDto>.Fail("A rejection reason is required.", "notes");

        batch.Status = accepted ? "Accepted" : "Rejected";
        batch.AcceptedBy = signer;
        batch.AcceptedAt = DateTime.UtcNow;
        batch.DecisionNotes = notes;
        await audit.LogAsync(db, accepted ? AuditAction.Approve : AuditAction.Reject,
            "DigitalHandoverBatch", batch.Id.ToString(),
            "Delivered", $"{batch.Status}; receiver={signer}",
            $"Department {batch.Department} {batch.Status.ToLowerInvariant()} digital handover {batch.BatchRef}. {notes}".Trim(),
            ct);
        await db.SaveChangesAsync(ct);
        await audit.AnnounceAsync(RealtimeChannels.Digitization,
            accepted ? "digital-handover.accepted" : "digital-handover.rejected",
            batch.Id.ToString(), $"Digital handover {batch.BatchRef} {batch.Status.ToLowerInvariant()}.");
        return Result<DigitalHandoverBatchDto>.Ok(ToDto(batch));
    }

    public async Task<Result<DigitalHandoverPackage>> BuildPackageAsync(long id, CancellationToken ct = default)
    {
        var batch = await db.DigitalHandoverBatches.AsNoTracking()
            .Include(row => row.Items)
            .FirstOrDefaultAsync(row => row.Id == id, ct);
        if (batch is null) return Result<DigitalHandoverPackage>.Fail("Digital handover batch not found.");
        if (batch.Status is not ("Delivered" or "Accepted" or "Rejected"))
            return Result<DigitalHandoverPackage>.Fail("Only a delivered handover can be downloaded.", "status");

        var output = new MemoryStream();
        try
        {
            using (var archive = new ZipArchive(output, ZipArchiveMode.Create, true, Encoding.UTF8))
            {
                var manifest = archive.CreateEntry("manifest.json", CompressionLevel.Optimal);
                await using (var stream = manifest.Open())
                await using (var writer = new StreamWriter(stream, new UTF8Encoding(false), 1024, true))
                    await writer.WriteAsync(batch.ManifestJson);

                var csv = new StringBuilder();
                csv.AppendLine("File ID,File Number,Department,File Name,Version,Page Count,Size Bytes,SHA256,Document ID");
                foreach (var item in batch.Items.OrderBy(row => row.FileNumber, StringComparer.OrdinalIgnoreCase))
                {
                    csv.Append(Csv(item.RecordFileId.ToString()))
                        .Append(',').Append(Csv(item.FileNumber))
                        .Append(',').Append(Csv(item.Department))
                        .Append(',').Append(Csv(item.FileName))
                        .Append(',').Append(item.Version)
                        .Append(',').Append(item.PageCount?.ToString() ?? string.Empty)
                        .Append(',').Append(item.SizeBytes)
                        .Append(',').Append(item.Sha256)
                        .Append(',').Append(item.RecordFileDocumentId)
                        .AppendLine();
                }
                var csvEntry = archive.CreateEntry("metadata.csv", CompressionLevel.Optimal);
                await using (var stream = csvEntry.Open())
                await using (var writer = new StreamWriter(stream, new UTF8Encoding(false), leaveOpen: true))
                    await writer.WriteAsync(csv.ToString());

                foreach (var item in batch.Items.OrderBy(row => row.FileNumber, StringComparer.OrdinalIgnoreCase))
                {
                    ct.ThrowIfCancellationRequested();
                    var document = await db.FileDocuments.AsNoTracking()
                        .FirstOrDefaultAsync(row => row.Id == item.RecordFileDocumentId, ct);
                    if (document is null || document.DocumentKind != "FinalPdf"
                        || document.Sha256 != item.Sha256 || document.SizeBytes != item.SizeBytes)
                        return Result<DigitalHandoverPackage>.Fail(
                            $"The source PDF for file {item.FileNumber} no longer matches the manifest.",
                            "manifest");
                    await using var source = await documentStore.OpenReadAsync(document.StorageKey, ct);
                    if (source is null)
                        return Result<DigitalHandoverPackage>.Fail(
                            $"The source PDF for file {item.FileNumber} is missing from private storage.",
                            "manifest");

                    var entryName = $"documents/{SafePart(item.FileNumber)}-{item.Id}.pdf";
                    var entry = archive.CreateEntry(entryName, CompressionLevel.NoCompression);
                    using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                    await using (var destination = entry.Open())
                    {
                        var buffer = new byte[81920];
                        while (true)
                        {
                            var read = await source.ReadAsync(buffer.AsMemory(0, buffer.Length), ct);
                            if (read == 0) break;
                            hash.AppendData(buffer, 0, read);
                            await destination.WriteAsync(buffer.AsMemory(0, read), ct);
                        }
                    }
                    var actualHash = Convert.ToHexString(hash.GetHashAndReset());
                    if (!string.Equals(actualHash, item.Sha256, StringComparison.OrdinalIgnoreCase))
                        return Result<DigitalHandoverPackage>.Fail(
                            $"The source PDF for file {item.FileNumber} failed its SHA-256 check.",
                            "manifest");
                }
            }

            output.Position = 0;
            using var packageHash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var packageBuffer = new byte[81920];
            while (true)
            {
                var read = await output.ReadAsync(packageBuffer.AsMemory(0, packageBuffer.Length), ct);
                if (read == 0) break;
                packageHash.AppendData(packageBuffer, 0, read);
            }
            var sha = Convert.ToHexString(packageHash.GetHashAndReset());
            output.Position = 0;

            await audit.LogAsync(db, AuditAction.Export, "DigitalHandoverBatch", batch.Id.ToString(),
                batch.ManifestSha256, $"downloaded; package-sha256={sha}",
                $"Downloaded digital handover package {batch.BatchRef} ({batch.Items.Count} file(s)).", ct);
            await db.SaveChangesAsync(ct);
            return Result<DigitalHandoverPackage>.Ok(new DigitalHandoverPackage(
                output, $"digital-handover-{SafePart(batch.BatchRef)}.zip", sha));
        }
        catch
        {
            await output.DisposeAsync();
            throw;
        }
    }

    private static string Csv(string value)
    {
        var safe = value.Replace("\r", " ").Replace("\n", " ");
        return $"\"{safe.Replace("\"", "\"\"")}\";
    }

    private static string SafePart(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var safe = new string(value.Where(ch => !invalid.Contains(ch) && ch is not '/' and not '\\' && !char.IsControl(ch)).ToArray());
        return string.IsNullOrWhiteSpace(safe) ? "handover" : safe[..Math.Min(safe.Length, 100)];
    }
}
