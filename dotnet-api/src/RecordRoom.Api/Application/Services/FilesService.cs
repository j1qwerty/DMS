using Microsoft.EntityFrameworkCore;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Auth;
using RecordRoom.Api.Infrastructure.Data;
using RecordRoom.Api.Infrastructure.Features;

namespace RecordRoom.Api.Application.Services;

public interface IFilesService
{
    Task<PagedResult<FileDto>> ListAsync(FileQuery q, CancellationToken ct = default);
    Task<FileDto?> GetAsync(int id, CancellationToken ct = default);
    Task<FileDto?> ByBarcodeAsync(string barcode, CancellationToken ct = default);
    Task<string[]> DepartmentsAsync(CancellationToken ct = default);
    Task<IReadOnlyList<FieldError>> ValidateCreateAsync(FileCreateInput input, CancellationToken ct = default);
    Task<Result<FileDto>> CreateAsync(FileCreateInput input, CancellationToken ct = default);
    Task<Result<FileDto>> RelocateAsync(int id, RelocateInput input, CancellationToken ct = default);
    Task<Result<FileDto>> UpdateEOfficeReferenceAsync(int id, EOfficeReferenceInput input, CancellationToken ct = default);
    Task<Result<bool>> DeleteAsync(int id, CancellationToken ct = default);
    Task<int> CountAsync(CancellationToken ct = default);
}

public sealed class FileQuery
{
    public string? Search { get; init; }
    public string? Department { get; init; }
    public string? Status { get; init; }
    public string? RecordKind { get; init; }
    public string? FileType { get; init; }
    public string? EOfficeStatus { get; init; }
    public int? RoomId { get; init; }
    public int? SectionId { get; init; }
    public int? ShelfId { get; init; }
    public string? Area { get; init; }
    public string? Sort { get; init; } = "fileNumber";
    public string? Direction { get; init; } = "asc";
    public int Page { get; init; } = 1;
    public int PageSize { get; init; } = 10;
}

public sealed class FilesService(
    AppDbContext db,
    IAuditWriter audit,
    ICurrentUserAccessor current,
    IPrivateDocumentStore documentStore,
    IFeatureFlags flags,
    Microsoft.Extensions.Configuration.IConfiguration configuration,
    ILogger<FilesService> logger) : IFilesService
{
    private const int MaxPosition = 100;

    /// <summary>
    /// Cached per process: probing sys.fulltext_indexes on every search would
    /// cost more than it saves. 0 = unknown, 1 = available, 2 = unavailable
    /// (int so the write is atomic without a lock).
    /// </summary>
    private static int fullTextState;

    /// <summary>
    /// Whether the Files table really has a full-text index to query. SQL Server
    /// Express (without advanced services) cannot host one, so the search must
    /// degrade to LIKE rather than error — the probe makes that decision once.
    /// </summary>
    private async Task<bool> FullTextAvailableAsync(CancellationToken ct)
    {
        // Search:UseFullText=false forces the LIKE path everywhere (a support escape hatch).
        if (!FeatureFlags.Parse(configuration["Search:UseFullText"], fallback: true)) return false;
        var cached = Interlocked.CompareExchange(ref fullTextState, 0, 0);
        if (cached != 0) return cached == 1;
        try
        {
            var probe = await db.Database.SqlQueryRaw<int>("""
                SELECT CAST(CASE WHEN FULLTEXTSERVICEPROPERTY('IsFullTextInstalled') > 0
                                  AND EXISTS (SELECT 1 FROM sys.fulltext_indexes i
                                              JOIN sys.objects o ON o.object_id = i.object_id
                                              WHERE o.name = 'Files')
                                 THEN 1 ELSE 0 END AS int) AS Value
                """).FirstAsync(ct);
            Interlocked.Exchange(ref fullTextState, probe == 1 ? 1 : 2);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Full-text probe failed; registry search uses the LIKE path.");
            Interlocked.Exchange(ref fullTextState, 2);
        }
        return Interlocked.CompareExchange(ref fullTextState, 0, 0) == 1;
    }

    private static string Stamp(DateTime value) =>
        value.ToString("yyyy-MM-dd HH:mm", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>
    /// The legacy collection size. The API never pretends to hold it; this is
    /// only reported as <c>collectionTotal</c> so the UI can say
    /// "1-10 of 2,478,450" honestly.
    /// </summary>
    private const long RegistryTotal = 2_478_450;

    private static FileKind ParseKind(string? value) =>
        Enum.TryParse<FileKind>(value, true, out var kind) ? kind : FileKind.File;

    private static RecordStatus ParseStatus(string? value) =>
        Display.ParseRecord(value) ?? RecordStatus.Available;

    private static FileDto ToDto(RecordFile f, Section? section, StorageUnit? unit, Room? room) => new(
        f.Id, f.Barcode, f.FileNumber, f.Subject, f.Department, f.Year,
        Display.FileKind(f.FileKind), Display.Record(f.Status), f.LocationDisplay,
        f.RoomId, f.SectionId, f.AlmirahId, f.ShelfId, section?.Code ?? string.Empty, unit?.Code ?? string.Empty,
        f.Shelf?.Code ?? string.Empty, f.ShelfBarcode, f.ApproxPosition,
        f.Pincode, f.Area, f.PropertyNo, f.PropertyArea, f.Dealer, f.CodalLife,
        f.CreatedAt, f.CreatedBy, f.UpdatedAt, f.UpdatedBy, Stamp(f.LastMovementAt),
        f.Holder, f.HolderEmployeeCode, f.Description, f.RecordKind, f.DocumentSize, f.EOfficeReference);

    private async Task<FileDto?> ProjectAsync(RecordFile f, CancellationToken ct)
    {
        var shelf = f.ShelfId is null
            ? null
            : await db.Shelves.Include(s => s.StorageUnit!).ThenInclude(u => u.Section!)
                .FirstOrDefaultAsync(s => s.Id == f.ShelfId, ct);
        var unit = shelf?.StorageUnit;
        var room = unit is null ? null : await db.Rooms.FirstOrDefaultAsync(r => r.Id == unit.RoomId, ct);
        f.Shelf = shelf;
        return ToDto(f, unit?.Section, unit, room);
    }

    public async Task<PagedResult<FileDto>> ListAsync(FileQuery q, CancellationToken ct = default)
    {
        var query = db.Files.AsNoTracking().Include(f => f.Shelf).AsQueryable();

        if (!string.IsNullOrWhiteSpace(q.Search))
        {
            // D1 (work plan §2.1): case-insensitivity comes from the database
            // collation, not from LOWER(column) — wrapping the column side in a
            // function disables every IX_Files_* seek. Identity tokens
            // (barcode, file number, e-office reference) always match as a
            // prefix so the indexes can serve a seek. Free-text columns and the
            // OCR text of digitized pages go through SQL Server full-text
            // (§3.1) when the catalog exists, and fall back to LIKE substring
            // matching when it does not — same results shape, slower plan.
            var needle = q.Search.Trim();
            var useFullText = await FullTextAvailableAsync(ct);
            if (useFullText)
            {
                // Prefix term inside double quotes: "needle*" — a valid
                // full-text prefix search; quotes inside the needle are stripped.
                var prefix = $"\"{needle.Replace("\"", " ").Trim()}*\"";
                query = query.Where(f =>
                    f.Barcode.StartsWith(needle)
                    || f.FileNumber.StartsWith(needle)
                    || (f.EOfficeReference != null && f.EOfficeReference.StartsWith(needle))
                    || EF.Functions.Contains(f.Subject, prefix)
                    || EF.Functions.Contains(f.Department, prefix)
                    || EF.Functions.Contains(f.LocationDisplay, prefix)
                    || EF.Functions.Contains(f.Area!, prefix)
                    || EF.Functions.Contains(f.Holder!, prefix)
                    || db.ScanPages.Any(p => p.Barcode == f.Barcode
                        && p.OcrText != null && EF.Functions.Contains(p.OcrText, prefix))
                    // Uploaded document versions carry their own per-page OCR
                    // text; the registry search reaches it the same way.
                    || db.FileDocuments.Any(d => d.RecordFileId == f.Id
                        && d.Pages.Any(p => EF.Functions.Contains(p.OcrText, prefix))));
            }
            else
            {
                query = query.Where(f =>
                    f.Barcode.StartsWith(needle)
                    || f.FileNumber.StartsWith(needle)
                    || f.Subject.Contains(needle)
                    || f.Department.Contains(needle)
                    || f.LocationDisplay.Contains(needle)
                    || f.Area.Contains(needle)
                    || (f.EOfficeReference != null && f.EOfficeReference.StartsWith(needle))
                    || (f.Holder != null && f.Holder.Contains(needle))
                    || db.ScanPages.Any(p => p.Barcode == f.Barcode
                        && p.OcrText != null && p.OcrText.Contains(needle))
                    || db.FileDocuments.Any(d => d.RecordFileId == f.Id
                        && d.Pages.Any(p => p.OcrText.Contains(needle))));
            }
        }

        if (!string.IsNullOrWhiteSpace(q.Department) && q.Department != "All")
            query = query.Where(f => f.Department == q.Department);
        if (!string.IsNullOrWhiteSpace(q.Status) && q.Status != "All")
        {
            var status = Display.ParseRecord(q.Status) ?? RecordStatus.Available;
            query = query.Where(f => f.Status == status);
        }
        if (!string.IsNullOrWhiteSpace(q.RecordKind) && q.RecordKind != "All")
        {
            var recordKind = string.Equals(q.RecordKind, "Map", StringComparison.OrdinalIgnoreCase) ? "Map" : "File";
            query = query.Where(f => f.RecordKind == recordKind);
        }
        if (!string.IsNullOrWhiteSpace(q.FileType) && q.FileType != "All")
        {
            var fileKind = ParseKind(q.FileType);
            query = query.Where(f => f.FileKind == fileKind);
        }
        if (string.Equals(q.EOfficeStatus, "Linked", StringComparison.OrdinalIgnoreCase))
            query = query.Where(f => f.EOfficeReference != null && f.EOfficeReference.Trim() != string.Empty);
        else if (string.Equals(q.EOfficeStatus, "Not linked", StringComparison.OrdinalIgnoreCase))
            query = query.Where(f => f.EOfficeReference == null || f.EOfficeReference.Trim() == string.Empty);
        if (q.RoomId is not null) query = query.Where(f => f.RoomId == q.RoomId);
        if (q.SectionId is not null) query = query.Where(f => f.SectionId == q.SectionId);
        if (q.ShelfId is not null) query = query.Where(f => f.ShelfId == q.ShelfId);
        if (!string.IsNullOrWhiteSpace(q.Area) && q.Area != "All")
            query = query.Where(f => f.Area == q.Area);

        var descending = string.Equals(q.Direction, "desc", StringComparison.OrdinalIgnoreCase);
        query = (q.Sort?.ToLower()) switch
        {
            "subject" => descending ? query.OrderByDescending(f => f.Subject) : query.OrderBy(f => f.Subject),
            "filebarcode" => descending ? query.OrderByDescending(f => f.Barcode) : query.OrderBy(f => f.Barcode),
            "year" => descending ? query.OrderByDescending(f => f.Year) : query.OrderBy(f => f.Year),
            "department" => descending ? query.OrderByDescending(f => f.Department) : query.OrderBy(f => f.Department),
            "lastmovement" => descending ? query.OrderByDescending(f => f.LastMovementAt) : query.OrderBy(f => f.LastMovementAt),
            "shelf" => descending ? query.OrderByDescending(f => f.Shelf!.Code) : query.OrderBy(f => f.Shelf!.Code),
            "status" => descending ? query.OrderByDescending(f => f.Status) : query.OrderBy(f => f.Status),
            _ => descending ? query.OrderByDescending(f => f.FileNumber) : query.OrderBy(f => f.FileNumber),
        };

        var total = await query.CountAsync(ct);
        var page = Math.Max(1, q.Page);
        var pageSize = Math.Clamp(q.PageSize, 1, 200);
        var rows = await query.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);

        // Shelf codes are needed for the display path; one lookup, not N.
        var shelfIds = rows.Where(r => r.ShelfId is not null).Select(r => r.ShelfId!.Value).Distinct().ToList();
        var shelves = await db.Shelves.Include(s => s.StorageUnit!).ThenInclude(u => u.Section!)
            .Where(s => shelfIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, ct);
        var roomIds = shelves.Values.Select(s => s.StorageUnit!.RoomId).Distinct().ToList();
        var rooms = await db.Rooms.Where(r => roomIds.Contains(r.Id)).ToDictionaryAsync(r => r.Id, ct);

        var items = rows
            .Select(f =>
            {
                var shelf = f.ShelfId is not null && shelves.TryGetValue(f.ShelfId.Value, out var s) ? s : null;
                var unit = shelf?.StorageUnit;
                var room = unit is not null && rooms.TryGetValue(unit.RoomId, out var r) ? r : null;
                return ToDto(f, unit?.Section, unit, room);
            })
            .ToArray();

        // When a search is running, say which files matched through the OCR
        // text of their digitized pages rather than their own metadata — the
        // search page shows it as an "OCR text" chip.
        if (!string.IsNullOrWhiteSpace(q.Search))
        {
            var needle = q.Search.Trim();
            var pageBarcodes = rows.Select(r => r.Barcode).ToList();
            var ocrBarcodes = (await db.ScanPages.AsNoTracking()
                    .Where(p => pageBarcodes.Contains(p.Barcode)
                        && p.OcrText != null && p.OcrText.Contains(needle))
                    .Select(p => p.Barcode).Distinct().ToListAsync(ct))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            // Uploaded document versions carry their own persisted per-page OCR
            // text (DocumentVersionPages) — the same search must reach it.
            var docBarcodes = (await db.FileDocuments.AsNoTracking()
                    .Where(d => d.RecordFileId != 0 && pageBarcodes.Contains(d.RecordFile!.Barcode)
                        && d.Pages.Any(p => p.OcrText.Contains(needle)))
                    .Select(d => d.RecordFile!.Barcode).Distinct().ToListAsync(ct))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            ocrBarcodes.UnionWith(docBarcodes);
            if (ocrBarcodes.Count > 0)
            {
                items = items.Select(dto => ocrBarcodes.Contains(dto.FileBarcode)
                        && !MetadataMatches(rows.First(r => r.Barcode == dto.FileBarcode), needle)
                    ? dto with { MatchedVia = "ocr" }
                    : dto).ToArray();
            }
        }

        return new PagedResult<FileDto>(items, total, page, pageSize, RegistryTotal);
    }

    /// <summary>The same fields the search predicate matches on the file row itself.</summary>
    private static bool MetadataMatches(RecordFile f, string needle)
    {
        var comparison = StringComparison.OrdinalIgnoreCase;
        return f.Barcode.StartsWith(needle, comparison)
            || f.FileNumber.StartsWith(needle, comparison)
            || (f.EOfficeReference?.StartsWith(needle, comparison) ?? false)
            || f.Subject.Contains(needle, comparison)
            || f.Department.Contains(needle, comparison)
            || f.LocationDisplay.Contains(needle, comparison)
            || (f.Area?.Contains(needle, comparison) ?? false)
            || (f.Holder?.Contains(needle, comparison) ?? false);
    }

    public async Task<FileDto?> GetAsync(int id, CancellationToken ct = default)
    {
        var file = await db.Files.AsNoTracking().FirstOrDefaultAsync(f => f.Id == id, ct);
        if (file is null) return null;
        await RecordViewAsync(file, ct);
        return await ProjectAsync(file, ct);
    }

    /// <summary>
    /// The "who accessed" half of the audit scope (§1.1): opening a file's
    /// detail page leaves a View row. The same person re-opening the same file
    /// within five minutes counts once — registry refreshes must not flood the
    /// trail. Best effort: a logging failure never breaks the read.
    /// </summary>
    private async Task RecordViewAsync(RecordFile file, CancellationToken ct)
    {
        try
        {
            var actor = current.UserName;
            if (string.IsNullOrEmpty(actor)) return;

            var since = DateTime.UtcNow.AddMinutes(-5);
            var recent = await db.Audit.AsNoTracking().AnyAsync(e =>
                e.Action == AuditAction.View && e.Entity == "RecordFile"
                && e.EntityId == file.Id.ToString() && e.Actor == actor && e.At >= since, ct);
            if (recent) return;

            await audit.LogAsync(
                db, AuditAction.View, "RecordFile", file.Id.ToString(), "-", "-",
                $"{actor} opened {file.Barcode} — {file.Subject}.", ct);
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not record the file view for {FileId}.", file.Id);
        }
    }

    public async Task<FileDto?> ByBarcodeAsync(string barcode, CancellationToken ct = default)
    {
        var needle = barcode.Trim().ToUpperInvariant();
        var file = await db.Files.AsNoTracking()
            .FirstOrDefaultAsync(f => f.Barcode.ToUpper() == needle, ct);
        return file is null ? null : await ProjectAsync(file, ct);
    }

    public async Task<string[]> DepartmentsAsync(CancellationToken ct = default) =>
        await db.Files.AsNoTracking().Select(f => f.Department).Distinct().OrderBy(d => d).ToArrayAsync(ct);

    public async Task<int> CountAsync(CancellationToken ct = default) => await db.Files.CountAsync(ct);

    /// <summary>
    /// Mirrors the legacy <c>File.php</c> guards: unique barcode, shelf that
    /// exists and is active, known area, position range.
    /// </summary>
    public async Task<IReadOnlyList<FieldError>> ValidateCreateAsync(FileCreateInput input, CancellationToken ct)
    {
        var errors = new List<FieldError>();

        var barcode = input.FileBarcode?.Trim().ToUpperInvariant() ?? string.Empty;
        if (barcode.Length == 0)
        {
            // With barcodes off nobody types an id; CreateAsync generates the next one.
            if (flags.BarcodeEnabled)
                errors.Add(new FieldError("File barcode is required.", "fileBarcode"));
        }
        else if (!barcode.StartsWith("RF-"))
        {
            errors.Add(new FieldError("Legacy barcodes start with RF-.", "fileBarcode"));
        }
        else
        {
            // Legacy UNIQUE index on file_barcode.
            var clash = await db.Files.AnyAsync(f => f.Barcode.ToUpper() == barcode, ct);
            if (clash) errors.Add(new FieldError($"{barcode} is already registered.", "fileBarcode"));
        }

        if (string.IsNullOrWhiteSpace(input.Subject))
            errors.Add(new FieldError("Subject is required.", "subject"));
        if (!string.IsNullOrWhiteSpace(input.EOfficeReference) && input.EOfficeReference.Trim().Length > 200)
            errors.Add(new FieldError("E-office reference must be 200 characters or fewer.", "eOfficeReference"));
        if (string.IsNullOrWhiteSpace(input.Department))
            errors.Add(new FieldError("Department is required.", "department"));
        if (input.Year is < 1800 or > 2200)
            errors.Add(new FieldError("Enter a four-digit year.", "year"));

        // Placement is optional: a file can be registered before it is shelved.
        // Only an explicitly chosen shelf is validated.
        if (input.ShelfId is int shelfId)
        {
            var shelf = await db.Shelves.FirstOrDefaultAsync(s => s.Id == shelfId, ct);
            if (shelf is null)
            {
                errors.Add(new FieldError("Select a shelf.", "shelfId"));
            }
            else if (shelf.Status != StorageStatus.Active)
            {
                errors.Add(new FieldError(
                    $"{shelf.Code} is {Display.Storage(shelf.Status).ToLower()} and cannot accept new files.", "shelfId"));
            }
            else if (shelf.Occupied >= shelf.Capacity)
            {
                errors.Add(new FieldError($"{shelf.Code} is full ({shelf.Occupied}/{shelf.Capacity}).", "shelfId"));
            }

            if (input.Position is < 1 or > MaxPosition)
                errors.Add(new FieldError($"Position must be between 1 and {MaxPosition}.", "position"));
        }

        var areaName = input.Area?.Trim() ?? string.Empty;
        if (areaName.Length > 0)
        {
            var area = await db.Areas.FirstOrDefaultAsync(a => a.Name == areaName, ct);
            if (area is null)
                errors.Add(new FieldError($"{areaName} is not a known area.", "area"));
            else if (!area.Active)
                errors.Add(new FieldError($"{area.Name} is inactive in the area master.", "area"));
        }

        return errors;
    }

    /// <summary>
    /// Next internal id in the RF series. Fixed-width digits make the text maximum the
    /// numeric maximum, so this is one indexed lookup, not a scan of every file.
    /// </summary>
    private async Task<string> NextBarcodeAsync(CancellationToken ct)
    {
        var highest = await db.Files
            .Where(f => f.Barcode.StartsWith("RF-"))
            .OrderByDescending(f => f.Barcode)
            .Select(f => f.Barcode)
            .FirstOrDefaultAsync(ct);
        return DerivedIds.NextFileBarcode(highest);
    }

    public async Task<Result<FileDto>> CreateAsync(FileCreateInput input, CancellationToken ct)
    {
        var errors = await ValidateCreateAsync(input, ct);
        if (errors.Count > 0) return Result<FileDto>.Fail(errors);

        var barcode = input.FileBarcode?.Trim().ToUpperInvariant() ?? string.Empty;
        if (barcode.Length == 0) barcode = await NextBarcodeAsync(ct);
        var now = DateTime.UtcNow;

        // Placement is optional (user decision 2026-10-28): a file can be
        // registered now and shelved later from its own page. An unplaced file
        // skips the shelf lookup and the occupancy bump.
        Shelf? shelf = null;
        StorageUnit? unit = null;
        Room? room = null;
        if (input.ShelfId is int shelfId)
        {
            shelf = await db.Shelves.Include(s => s.StorageUnit!).ThenInclude(u => u.Section!)
                .FirstAsync(s => s.Id == shelfId, ct);
            unit = shelf.StorageUnit!;
            room = await db.Rooms.FirstAsync(r => r.Id == unit.RoomId, ct);
        }
        var area = string.IsNullOrWhiteSpace(input.Area)
            ? null
            : await db.Areas.FirstOrDefaultAsync(a => a.Name == input.Area.Trim(), ct);

        var file = new RecordFile
        {
            Barcode = barcode,
            FileNumber = $"{input.Department.Trim().ToUpperInvariant()}/{input.Year}/{barcode[^4..]}",
            Subject = input.Subject.Trim(),
            Department = input.Department.Trim(),
            Year = input.Year,
            FileKind = ParseKind(input.FileType),
            RecordKind = input.RecordKind is null
                ? (string.Equals(input.DocumentSize, "A0", StringComparison.OrdinalIgnoreCase) ? "Map" : "File")
                : (string.Equals(input.RecordKind, "Map", StringComparison.OrdinalIgnoreCase) ? "Map" : "File"),
            DocumentSize = input.DocumentSize is "A0" or "A1" or "A2" or "A3" or "A4" ? input.DocumentSize : "Other",
            EOfficeReference = string.IsNullOrWhiteSpace(input.EOfficeReference) ? null : input.EOfficeReference.Trim(),
            Status = RecordStatus.Available,
            RoomId = room?.Id,
            SectionId = unit?.SectionId,
            AlmirahId = unit?.Id,
            ShelfId = shelf?.Id,
            ShelfBarcode = shelf?.Barcode ?? string.Empty,
            ApproxPosition = shelf is null ? 0 : input.Position,
            Pincode = string.IsNullOrWhiteSpace(input.Pincode) ? area?.Pincode ?? string.Empty : input.Pincode.Trim(),
            Area = input.Area?.Trim() ?? string.Empty,
            PropertyNo = input.PropertyNo?.Trim() ?? string.Empty,
            PropertyArea = input.PropertyArea?.Trim() ?? string.Empty,
            Dealer = input.Dealer?.Trim() ?? string.Empty,
            CodalLife = input.CodalLife?.Trim() ?? string.Empty,
            Description = input.Description?.Trim() ?? string.Empty,
            LocationDisplay = shelf is null ? "Not placed" : $"{room!.Code} / {unit!.Section?.Code} / {unit.Code} / {shelf.Code}",
            CreatedAt = now,
            CreatedBy = current.UserName,
            UpdatedAt = now,
            UpdatedBy = current.UserName,
            LastMovementAt = now,
        };

        // One transaction: the file, the occupancy counter, the movement event
        // and the audit row either all land or none do.
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        db.Files.Add(file);
        await db.SaveChangesAsync(ct);

        if (shelf is not null) shelf.Occupied += 1;
        await audit.RecordMovementAsync(db, MovementKind.FileCreated, file, "-", file.LocationDisplay,
            shelf is null
                ? "Registered without physical placement."
                : $"Registered on shelf {shelf.Code} (barcode {shelf.Barcode}).");
        await audit.LogAsync(db, AuditAction.Create, "RecordFile", file.Id.ToString(),
            "-", $"{file.Barcode} @ {(shelf is null ? "not placed" : shelf.Code)}",
            $"Created {file.FileNumber} - {file.Subject}");
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        await audit.AnnounceAsync(RealtimeChannels.Files, "file.created", file.Id.ToString(),
            shelf is null
                ? $"{file.Barcode} registered (not placed yet)"
                : $"{file.Barcode} registered on {shelf.Code}");

        return Result<FileDto>.Ok(ToDto(file, unit?.Section, unit, room));
    }

    public async Task<Result<FileDto>> RelocateAsync(int id, RelocateInput input, CancellationToken ct)
    {
        var file = await db.Files.FirstOrDefaultAsync(f => f.Id == id, ct);
        if (file is null) return Result<FileDto>.Fail("File not found.", "id");
        if (file.Status == RecordStatus.Issued)
            return Result<FileDto>.Fail("Return the file before changing its shelf.", "shelfId");

        var shelf = await db.Shelves.Include(s => s.StorageUnit!).ThenInclude(u => u.Section!)
            .FirstOrDefaultAsync(s => s.Id == input.ShelfId, ct);
        if (shelf is null) return Result<FileDto>.Fail("Shelf not found.", "shelfId");
        if (shelf.Status != StorageStatus.Active)
            return Result<FileDto>.Fail($"{shelf.Code} is {shelf.Status.ToString().ToLower()}.", "shelfId");
        if (input.Position is < 1 or > MaxPosition)
            return Result<FileDto>.Fail($"Position must be between 1 and {MaxPosition}.", "position");

        var unit = shelf.StorageUnit!;
        var room = await db.Rooms.FirstAsync(r => r.Id == unit.RoomId, ct);
        var from = file.LocationDisplay;
        var now = DateTime.UtcNow;

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        if (file.ShelfId != shelf.Id)
        {
            var previous = await db.Shelves.FirstOrDefaultAsync(s => s.Id == file.ShelfId, ct);
            if (previous is not null) previous.Occupied = Math.Max(0, previous.Occupied - 1);
            shelf.Occupied += 1;
        }

        file.RoomId = room.Id;
        file.SectionId = unit.SectionId;
        file.AlmirahId = unit.Id;
        file.ShelfId = shelf.Id;
        file.ShelfBarcode = shelf.Barcode;
        file.ApproxPosition = input.Position;
        file.LocationDisplay = $"{room.Code} / {unit.Section?.Code} / {unit.Code} / {shelf.Code}";
        file.UpdatedAt = now;
        file.UpdatedBy = current.UserName;
        file.LastMovementAt = now;

        await audit.RecordMovementAsync(db, MovementKind.LocationChange, file, from, file.LocationDisplay,
            string.IsNullOrWhiteSpace(input.Reason) ? "Shelf reassigned from the file registry." : input.Reason.Trim());
        await audit.LogAsync(db, AuditAction.Relocate, "RecordFile", file.Id.ToString(),
            $"shelf={from}", $"shelf={file.LocationDisplay}",
            $"{file.Barcode} relocated to {shelf.Code}");
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        await audit.AnnounceAsync(RealtimeChannels.Files, "file.relocated", file.Id.ToString(),
            $"{file.Barcode} moved to {shelf.Code}");

        return Result<FileDto>.Ok(ToDto(file, unit.Section, unit, room));
    }

    public async Task<Result<FileDto>> UpdateEOfficeReferenceAsync(
        int id,
        EOfficeReferenceInput input,
        CancellationToken ct = default)
    {
        var file = await db.Files.FirstOrDefaultAsync(f => f.Id == id, ct);
        if (file is null) return Result<FileDto>.Fail("File not found.", "id");

        var reference = input.EOfficeReference?.Trim();
        if (reference?.Length > 200)
            return Result<FileDto>.Fail(
                "E-office reference must be 200 characters or fewer.",
                "eOfficeReference");

        var previous = file.EOfficeReference;
        file.EOfficeReference = string.IsNullOrWhiteSpace(reference) ? null : reference;
        file.UpdatedAt = DateTime.UtcNow;
        file.UpdatedBy = current.UserName;

        await audit.LogAsync(
            db,
            AuditAction.Update,
            "RecordFile",
            file.Id.ToString(),
            previous ?? "Not linked",
            file.EOfficeReference ?? "Not linked",
            $"Updated e-office reference for {file.Barcode}");
        await db.SaveChangesAsync(ct);

        await audit.AnnounceAsync(
            RealtimeChannels.Files,
            "file.updated",
            file.Id.ToString(),
            $"E-office reference updated for {file.Barcode}");

        return Result<FileDto>.Ok(await ProjectAsync(file, ct) ?? ToDto(file, null, null, null));
    }

    public async Task<Result<bool>> DeleteAsync(int id, CancellationToken ct)
    {
        var file = await db.Files.FirstOrDefaultAsync(f => f.Id == id, ct);
        if (file is null) return Result<bool>.Fail("File not found.", "id");
        if (file.Status == RecordStatus.Issued)
            return Result<bool>.Fail("This file is issued. Return it before deleting the registry row.", "id");

        // Guards with reasons instead of raw FK 500s: every restrict-FK child
        // that must stay traceable blocks the delete with a readable message.
        var issueLines = await db.IssueLines.CountAsync(l => l.RecordFileId == id, ct);
        if (issueLines > 0)
            return Result<bool>.Fail(
                $"{issueLines} issue receipt line(s) reference this file; issue history must stay traceable.", "id");

        var scans = await db.ScanPages.CountAsync(p => p.Barcode == file.Barcode, ct);
        if (scans > 0)
            return Result<bool>.Fail($"{scans} scan page(s) still belong to this file. Remove them first.", "id");

        var maps = await db.Maps.CountAsync(m => m.Barcode == file.Barcode, ct);
        if (maps > 0)
            return Result<bool>.Fail($"{maps} map/copy row(s) still belong to this file. Remove them first.", "id");

        var documentKeys = await db.FileDocuments.AsNoTracking()
            .Where(document => document.RecordFileId == id)
            .Select(document => document.StorageKey)
            .ToArrayAsync(ct);

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        db.Files.Remove(file);
        await db.SaveChangesAsync(ct);

        var shelf = await db.Shelves.FirstOrDefaultAsync(s => s.Id == file.ShelfId, ct);
        if (shelf is not null) shelf.Occupied = Math.Max(0, shelf.Occupied - 1);

        await audit.LogAsync(db, AuditAction.Delete, "RecordFile", id.ToString(),
            $"{file.Barcode} @ {file.ShelfBarcode}", "deleted",
            $"Registry row removed for {file.Barcode}");
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        foreach (var key in documentKeys)
        {
            try { await documentStore.DeleteAsync(key, CancellationToken.None); }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Could not remove attachment content {StorageKey} after record {FileId} deletion.", key, id);
            }
        }

        await audit.AnnounceAsync(RealtimeChannels.Files, "file.deleted", id.ToString(),
            $"{file.Barcode} removed from the registry");
        return Result<bool>.Ok(true);
    }
}