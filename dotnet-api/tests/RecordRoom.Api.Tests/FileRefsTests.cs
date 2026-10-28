using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Application.Services;

namespace RecordRoom.Api.Tests;

/// <summary>Pure helpers behind "work by file number" and the room / shelf id rules.</summary>
public class FileRefsTests
{
    [Theory]
    [InlineData("RF-0000199103 — Released to batch 041.", "Released to batch 041.")]
    [InlineData("RF-0000199103 - Issued on receipt ISS-2026-0001.", "Issued on receipt ISS-2026-0001.")]
    [InlineData("RF-0000199103 – Returned.", "Returned.")]
    [InlineData("Moved RF-0000199103 to shelf A", "Moved this file to shelf A")]
    [InlineData("No ids in this sentence.", "No ids in this sentence.")]
    [InlineData("RF-12 is too short to be an id.", "RF-12 is too short to be an id.")]
    public void HideIds_removes_the_internal_id_and_keeps_the_sentence_readable(string text, string expected) =>
        Assert.Equal(expected, FileRefs.HideIds(text));

    [Fact]
    public void HideIds_copes_with_empty_text()
    {
        Assert.Equal(string.Empty, FileRefs.HideIds(null));
        Assert.Equal(string.Empty, FileRefs.HideIds(string.Empty));
    }

    [Theory]
    [InlineData("A-019-S-01", "A019S01")]
    [InlineData("lko01-s-04", "LKO01S04")]
    [InlineData("  a 1/b  ", "A1B")]
    [InlineData("", "")]
    [InlineData(null, "")]
    public void FromCode_derives_an_internal_id_from_a_code(string? code, string expected) =>
        Assert.Equal(expected, DerivedIds.FromCode(code));

    [Theory]
    [InlineData(null, "RF-0000000001")]
    [InlineData("", "RF-0000000001")]
    [InlineData("RF-0000199103", "RF-0000199104")]
    [InlineData("RF-0000009999", "RF-0000010000")]
    public void NextFileBarcode_continues_the_RF_series(string? highest, string expected) =>
        Assert.Equal(expected, DerivedIds.NextFileBarcode(highest));

    [Fact]
    public void NextFileBarcode_keeps_fixed_width_so_text_order_matches_number_order()
    {
        var a = DerivedIds.NextFileBarcode("RF-0000000009");
        var b = DerivedIds.NextFileBarcode(a);
        Assert.True(string.CompareOrdinal(b, a) > 0);
        Assert.Equal(13, a.Length);
    }

    [Fact]
    public void NextRoomCode_starts_at_001_and_follows_the_highest_code()
    {
        Assert.Equal("RM-001", DerivedIds.NextRoomCode(Array.Empty<string>()));
        Assert.Equal("RM-004", DerivedIds.NextRoomCode(new[] { "RM-001", "RM-003", "RM-002" }));
    }

    [Fact]
    public void NextRoomCode_ignores_gaps_and_odd_codes_and_never_reuses_a_number()
    {
        // A deleted RM-002 leaves a gap; the next room must not take it, because labels
        // and history may still refer to it.
        Assert.Equal("RM-004", DerivedIds.NextRoomCode(new[] { "RM-001", "RM-003", "ANNEX" }));
        Assert.Equal("RM-1001", DerivedIds.NextRoomCode(new[] { "RM-1000" }));
    }

    [Fact]
    public void Barcode_columns_are_dropped_and_rows_stay_aligned()
    {
        string[] columns = ["Barcode", "Number", "Subject", "Shelf", "Shelf barcode", "Last movement"];
        object[][] rows =
        [
            ["RF-1", "ENG/1", "Bridge", "A-01", "A01", "2026-01-01"],
            ["RF-2", "ENG/2", "Road", "A-02", "A02", "2026-01-02"],
        ];

        var (kept, keptRows) = ReportsService.BarcodeColumns.Strip(columns, rows);

        Assert.Equal(new[] { "Number", "Subject", "Shelf", "Last movement" }, kept);
        Assert.All(keptRows, row => Assert.Equal(kept.Length, row.Length));
        Assert.Equal(
            new[] { "ENG/1", "Bridge", "A-01", "2026-01-01" },
            keptRows[0].Select(c => c?.ToString()).ToArray());
    }

    [Fact]
    public void Report_definitions_lose_barcode_columns_and_wording()
    {
        var definition = new ReportDefinitionDto(
            "file-registry", "File registry",
            "Registry master data with shelf barcode, location and status.",
            ["Barcode", "Number", "Shelf barcode"], "File.php");

        var stripped = ReportsService.BarcodeColumns.Strip(definition);

        Assert.Equal(new[] { "Number" }, stripped.Columns);
        Assert.DoesNotContain("barcode", stripped.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Reports_without_barcode_columns_are_left_alone()
    {
        string[] columns = ["Receipt", "Borrower"];
        object[][] rows = [["ISS-1", "A. Kumar"]];
        var (kept, keptRows) = ReportsService.BarcodeColumns.Strip(columns, rows);
        Assert.Equal(columns, kept);
        Assert.Single(keptRows);
    }
}
