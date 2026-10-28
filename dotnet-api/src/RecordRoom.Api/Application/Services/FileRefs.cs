using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Data;
using RecordRoom.Api.Infrastructure.Features;

namespace RecordRoom.Api.Application.Services;

/// <summary>
/// Everything that lets the API work by file number instead of barcode:
/// finding a file from typed text, adding the file number to rows that only carry the
/// internal id, and keeping that id out of sentences when barcodes are off.
/// </summary>
public interface IFileRefs
{
    /// <summary>
    /// Finds a file from a barcode OR a file number. A barcode match wins. A file number
    /// that more than one file shares is refused instead of guessed.
    /// </summary>
    Task<Result<RecordFile>> FindAsync(string? text, CancellationToken ct = default);

    Task<MapUploadDto[]> EnrichAsync(MapUploadDto[] rows, CancellationToken ct = default);
    Task<IssueDto[]> EnrichAsync(IssueDto[] rows, CancellationToken ct = default);
    Task<MovementDto[]> EnrichAsync(MovementDto[] rows, CancellationToken ct = default);
    Task<DigitizationBatchDto[]> EnrichAsync(DigitizationBatchDto[] rows, CancellationToken ct = default);
    Task<DigitizationPageDto[]> EnrichAsync(DigitizationPageDto[] rows, CancellationToken ct = default);

    /// <summary>File numbers for the given file ids.</summary>
    Task<Dictionary<int, string>> NumbersByIdAsync(IEnumerable<int> ids, CancellationToken ct = default);
}

public sealed partial class FileRefs(AppDbContext db, IFeatureFlags flags) : IFileRefs
{
    public async Task<Result<RecordFile>> FindAsync(string? text, CancellationToken ct = default)
    {
        var value = text?.Trim().ToUpperInvariant() ?? string.Empty;
        if (value.Length == 0) return Result<RecordFile>.Fail("Enter a file number.", "fileBarcode");

        // At most three rows: enough to tell "none", "one" and "ambiguous" apart.
        var matches = await db.Files
            .Where(f => f.Barcode.ToUpper() == value || f.FileNumber.ToUpper() == value)
            .Take(3)
            .ToListAsync(ct);

        var byBarcode = matches.FirstOrDefault(f => string.Equals(f.Barcode, value, StringComparison.OrdinalIgnoreCase));
        if (byBarcode is not null && flags.BarcodeEnabled) return Result<RecordFile>.Ok(byBarcode);

        var byNumber = matches
            .Where(f => string.Equals(f.FileNumber, value, StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (byNumber.Count == 1) return Result<RecordFile>.Ok(byNumber[0]);
        if (byNumber.Count > 1)
        {
            return Result<RecordFile>.Fail(
                $"More than one file has the number {value}. Open the file and use its own page instead.",
                "fileBarcode");
        }

        // With barcodes off the internal id is not something a person knows, but a stored
        // client may still send it; accept it rather than break an existing link.
        if (byBarcode is not null) return Result<RecordFile>.Ok(byBarcode);

        return Result<RecordFile>.Fail(
            flags.BarcodeEnabled
                ? $"{value} is not in the registry."
                : $"No file has the number {value}.",
            "fileBarcode");
    }

    public async Task<Dictionary<int, string>> NumbersByIdAsync(IEnumerable<int> ids, CancellationToken ct = default)
    {
        var wanted = ids.Distinct().ToArray();
        if (wanted.Length == 0) return [];
        var rows = await db.Files.AsNoTracking()
            .Where(f => wanted.Contains(f.Id))
            .Select(f => new { f.Id, f.FileNumber })
            .ToListAsync(ct);
        return rows.ToDictionary(r => r.Id, r => r.FileNumber);
    }

    private async Task<Dictionary<string, (int Id, string Number)>> ByBarcodesAsync(
        IEnumerable<string> barcodes, CancellationToken ct)
    {
        var wanted = barcodes.Where(b => !string.IsNullOrWhiteSpace(b)).Distinct().ToArray();
        if (wanted.Length == 0) return [];
        var rows = await db.Files.AsNoTracking()
            .Where(f => wanted.Contains(f.Barcode))
            .Select(f => new { f.Barcode, f.Id, f.FileNumber })
            .ToListAsync(ct);
        return rows.ToDictionary(r => r.Barcode, r => (r.Id, r.FileNumber), StringComparer.OrdinalIgnoreCase);
    }

    public async Task<MapUploadDto[]> EnrichAsync(MapUploadDto[] rows, CancellationToken ct = default)
    {
        var files = await ByBarcodesAsync(rows.Select(r => r.FileBarcode), ct);
        return rows.Select(r => files.TryGetValue(r.FileBarcode, out var f)
            ? r with { FileNumber = f.Number, FileId = f.Id }
            : r).ToArray();
    }

    public async Task<IssueDto[]> EnrichAsync(IssueDto[] rows, CancellationToken ct = default)
    {
        var numbers = await NumbersByIdAsync(rows.SelectMany(r => r.Lines).Select(l => l.FileId), ct);
        return rows.Select(r => r with
        {
            Lines = r.Lines.Select(l => numbers.TryGetValue(l.FileId, out var n) ? l with { FileNumber = n } : l).ToArray(),
        }).ToArray();
    }

    public async Task<MovementDto[]> EnrichAsync(MovementDto[] rows, CancellationToken ct = default)
    {
        var numbers = await NumbersByIdAsync(rows.Select(r => r.FileId), ct);
        return rows.Select(r =>
        {
            var next = numbers.TryGetValue(r.FileId, out var n) ? r with { FileNumber = n } : r;
            // The stored sentence was written with the id in it; hide it while barcodes are off.
            return flags.BarcodeEnabled ? next : next with { Detail = HideIds(next.Detail) };
        }).ToArray();
    }

    public async Task<DigitizationPageDto[]> EnrichAsync(DigitizationPageDto[] rows, CancellationToken ct = default)
    {
        var files = await ByBarcodesAsync(rows.Select(r => r.FileBarcode), ct);
        return rows.Select(r => files.TryGetValue(r.FileBarcode, out var f) ? r with { FileNumber = f.Number } : r).ToArray();
    }

    public async Task<DigitizationBatchDto[]> EnrichAsync(DigitizationBatchDto[] rows, CancellationToken ct = default)
    {
        var files = await ByBarcodesAsync(rows.SelectMany(b => b.Pages).Select(p => p.FileBarcode), ct);
        return rows.Select(b => b with
        {
            Pages = b.Pages.Select(p => files.TryGetValue(p.FileBarcode, out var f) ? p with { FileNumber = f.Number } : p).ToArray(),
        }).ToArray();
    }

    [GeneratedRegex(@"\bRF-\d{6,}\s*[—–-]\s*")]
    private static partial Regex LeadingId();

    [GeneratedRegex(@"\bRF-\d{6,}\b")]
    private static partial Regex AnyId();

    /// <summary>
    /// Removes the internal file id from a server-written sentence so it still reads
    /// well: "RF-0000199103 - Released to batch 041." becomes "Released to batch 041.".
    /// </summary>
    public static string HideIds(string? text)
    {
        if (string.IsNullOrEmpty(text)) return text ?? string.Empty;
        return AnyId().Replace(LeadingId().Replace(text, string.Empty), "this file");
    }
}

/// <summary>Small pure helpers, kept apart so they can be unit tested without a database.</summary>
public static class DerivedIds
{
    /// <summary>
    /// Internal id for a shelf or almirah created without a barcode: the code with
    /// everything but letters and digits removed, upper-cased ("A-019-S-01" becomes "A019S01").
    /// </summary>
    public static string FromCode(string? code) =>
        new string((code ?? string.Empty).Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();

    /// <summary>Next internal file id in the RF series, given the highest existing one.</summary>
    public static string NextFileBarcode(string? highest)
    {
        var digits = new string((highest ?? string.Empty).Where(char.IsDigit).ToArray());
        var next = long.TryParse(digits, out var n) ? n + 1 : 1;
        return $"RF-{next:D10}";
    }

    /// <summary>Next room code ("RM-001", "RM-002", ...) from the codes already in use.</summary>
    public static string NextRoomCode(IEnumerable<string> existing)
    {
        var highest = 0;
        foreach (var code in existing)
        {
            var digits = new string((code ?? string.Empty).Where(char.IsDigit).ToArray());
            if (int.TryParse(digits, out var n) && n > highest) highest = n;
        }
        return $"RM-{highest + 1:D3}";
    }
}
