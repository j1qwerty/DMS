using System.Globalization;
using System.Text;
using CsvHelper;
using Microsoft.EntityFrameworkCore;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Auth;
using RecordRoom.Api.Infrastructure.Data;
using RecordRoom.Api.Infrastructure.Features;

namespace RecordRoom.Api.Application.Services;

public interface IReportsService
{
    ReportDefinitionDto[] Definitions();
    ReportResultDto Build(string key);
    /// <summary>Streams the CSV so a large export never buffers in memory.</summary>
    string BuildCsv(string key, out int rowCount);
    byte[] BuildCsvBytes(string key);
}

public sealed class ReportsService(AppDbContext db, IFeatureFlags flags) : IReportsService
{
    private static readonly ReportDefinitionDto[] Defs =
    [
        new("issue-register", "Issue register",
            "Every receipt with its borrower, purpose, due date and open-file count.",
            ["Receipt", "Issued at", "Borrower", "Code", "Department", "Purpose", "Due", "Status", "Open files"],
            "Record.php issue list"),
        new("return-register", "Return register",
            "Receipts with at least one returned file, including the return timestamp.",
            ["Receipt", "Borrower", "Returned at", "Returned", "Open", "Status"],
            "Record.php returnfilelist"),
        new("movement-log", "Movement log",
            "Issue, return, relocation and digitization events in reverse chronology.",
            ["At", "Kind", "Barcode", "Subject", "From", "To", "Actor", "Detail"],
            "activity_log_tbl projection"),
        new("file-registry", "File registry",
            "Registry master data with shelf barcode, location and status.",
            ["Barcode", "Number", "Subject", "Department", "Year", "Status", "Shelf", "Shelf barcode", "Last movement"],
            "File.php file listing"),
        new("digitization-progress", "Digitization progress",
            "Per-file scan page counts with approval state per file.",
            ["FileNumber", "Barcode", "Department", "Year", "Pages", "Approved", "Rejected", "Pending", "FileStatus"],
            "User.php uploadservice report"),
        new("login-history", "Login history",
            "Web and mobile sign-in attempts with IP, client and outcome.",
            ["Login at", "Logout at", "User", "Role", "Channel", "IP", "Client", "Outcome", "Detail"],
            "User.php login_history export"),
        new("location-occupancy", "Location occupancy",
            "Shelf-level occupancy for capacity planning and re-shelving.",
            ["Room", "Section", "Almirah", "Shelf", "Barcode", "Status", "Occupied", "Capacity", "Free"],
            "Store.php shelf listing"),
        new("overdue-files", "Overdue files",
            "Open receipts past their due date, oldest due first.",
            ["Receipt", "Borrower", "Code", "Department", "Due", "Days late", "Open files", "Issued by"],
            "Employee_reports.php borrow_list"),
    ];

    public ReportDefinitionDto[] Definitions()
    {
        var available = flags.MovementEnabled ? Defs : Defs.Where(d => d.Key != "movement-log").ToArray();
        return flags.BarcodeEnabled ? available : available.Select(BarcodeColumns.Strip).ToArray();
    }

    /// <summary>
    /// With barcodes off, barcode columns (and the wording that mentions them) are left
    /// out of the definitions, the screen and the CSV. Pure, so it can be tested alone.
    /// </summary>
    public static class BarcodeColumns
    {
        public static bool IsBarcode(string column) =>
            column.Contains("barcode", StringComparison.OrdinalIgnoreCase);

        public static ReportDefinitionDto Strip(ReportDefinitionDto definition) => definition with
        {
            Columns = definition.Columns.Where(c => !IsBarcode(c)).ToArray(),
            Description = definition.Description.Replace(" with shelf barcode,", " with", StringComparison.OrdinalIgnoreCase),
        };

        public static (string[] Columns, object[][] Rows) Strip(string[] columns, object[][] rows)
        {
            var keep = columns.Select(c => !IsBarcode(c)).ToArray();
            return (
                columns.Where((_, i) => keep[i]).ToArray(),
                rows.Select(row => row.Where((_, i) => i >= keep.Length || keep[i]).ToArray()).ToArray());
        }
    }

    private static string Stamp(DateTime value) =>
        value.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);

    private static object[][] Rows(string key, AppDbContext db) => key switch
    {
        "issue-register" => db.Issues.AsNoTracking().Include(i => i.Lines)
            .OrderByDescending(i => i.IssuedAt).ToList()
            .Select(i => new object[]
            {
                i.ReceiptNumber, Stamp(i.IssuedAt), i.BorrowerName, i.BorrowerEmployeeCode,
                i.Department, i.Purpose, Stamp(i.DueAt), i.Status.ToString(),
                i.Lines.Count(l => l.ReturnedAt is null),
            }).ToArray(),

        "return-register" => db.Issues.AsNoTracking().Include(i => i.Lines)
            .Where(i => i.Lines.Any(l => l.ReturnedAt != null))
            .OrderByDescending(i => i.IssuedAt).ToList()
            .Select(i => new object[]
            {
                i.ReceiptNumber, i.BorrowerName,
                i.ReturnedAt.HasValue ? Stamp(i.ReturnedAt.Value) : "partial",
                i.Lines.Count(l => l.ReturnedAt != null),
                i.Lines.Count(l => l.ReturnedAt is null),
                i.Status.ToString(),
            }).ToArray(),

        "movement-log" => db.Movements.AsNoTracking()
            .OrderByDescending(m => m.At).Take(5000).ToList()
            .Select(m => new object[]
            {
                Stamp(m.At), m.Kind.ToString(), m.Barcode, m.Subject, m.From, m.To, m.Actor, m.Detail,
            }).ToArray(),

        "file-registry" => db.Files.AsNoTracking().Include(f => f.Shelf)
            .OrderBy(f => f.Barcode).ToList()
            .Select(f => new object[]
            {
                f.Barcode, f.FileNumber, f.Subject, f.Department, f.Year, f.Status.ToString(),
                f.Shelf?.Code ?? string.Empty, f.ShelfBarcode, Stamp(f.LastMovementAt),
            }).ToArray(),

        "digitization-progress" => db.Files.AsNoTracking()
            .Where(f => f.ScanPages.Any())
            .OrderBy(f => f.Barcode).ToList()
            .Select(f => new object[]
            {
                f.FileNumber, f.Barcode, f.Department, f.Year,
                f.ScanPages.Count,
                f.ScanPages.Count(p => p.Status == PageStatus.Approved),
                f.ScanPages.Count(p => p.Status == PageStatus.Rejected),
                f.ScanPages.Count(p => p.Status == PageStatus.PendingReview),
                Display.Record(f.Status),
            }).ToArray(),

        "login-history" => db.LoginHistory.AsNoTracking()
            .OrderByDescending(e => e.LoginAt).Take(5000).ToList()
            .Select(e => new object[]
            {
                Stamp(e.LoginAt), e.LogoutAt.HasValue ? Stamp(e.LogoutAt.Value) : "-",
                e.UserName, e.Role, e.Channel, e.Ip, e.UserAgent, e.Outcome.ToString(), e.Detail,
            }).ToArray(),

        "location-occupancy" => db.Shelves.AsNoTracking()
            .Include(s => s.StorageUnit!).ThenInclude(u => u.Section!).ThenInclude(s => s.Room!)
            .OrderBy(s => s.Code).ToList()
            .Select(s => new object[]
            {
                s.StorageUnit!.Section!.Room!.Code, s.StorageUnit.Section.Name,
                s.StorageUnit.Code, s.Code, s.Barcode, s.Status.ToString(),
                s.Occupied, s.Capacity, Math.Max(0, s.Capacity - s.Occupied),
            }).ToArray(),

        "overdue-files" => db.Issues.AsNoTracking().Include(i => i.Lines)
            .Where(i => i.Status == IssueStatus.Overdue)
            .OrderBy(i => i.DueAt).ToList()
            .Select(i => new object[]
            {
                i.ReceiptNumber, i.BorrowerName, i.BorrowerEmployeeCode, i.Department,
                Stamp(i.DueAt),
                Math.Max(0, (int)(DateTime.UtcNow - i.DueAt).TotalDays),
                i.Lines.Count(l => l.ReturnedAt is null), i.IssuedBy,
            }).ToArray(),

        _ => [],
    };

    public ReportResultDto Build(string key)
    {
        if (key == "movement-log" && !flags.MovementEnabled)
            throw new ArgumentException("Movement history is not enabled.", nameof(key));

        var definition = Defs.FirstOrDefault(d => d.Key == key)
            ?? throw new ArgumentException($"Unknown report '{key}'.", nameof(key));
        var rows = Rows(key, db);
        var columns = definition.Columns;
        if (!flags.BarcodeEnabled)
            (columns, rows) = BarcodeColumns.Strip(columns, rows);
        return new ReportResultDto(definition.Key, definition.Title, columns,
            rows, DateTime.UtcNow, rows.Length);
    }

    public string BuildCsv(string key, out int rowCount)
    {
        var result = Build(key);
        using var buffer = new MemoryStream();
        // RFC 4180 with a UTF-8 BOM so Excel keeps non-ASCII place names.
        using (var writer = new StreamWriter(buffer, new UTF8Encoding(true), leaveOpen: true))
        using (var csv = new CsvWriter(writer, CultureInfo.InvariantCulture))
        {
            foreach (var column in result.Columns) csv.WriteField(column);
            csv.NextRecord();
            foreach (var row in result.Rows)
            {
                foreach (var cell in row) csv.WriteField(cell?.ToString() ?? string.Empty);
                csv.NextRecord();
            }
        }

        rowCount = result.RowCount;
        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    public byte[] BuildCsvBytes(string key) => Encoding.UTF8.GetBytes(BuildCsv(key, out _));
}
