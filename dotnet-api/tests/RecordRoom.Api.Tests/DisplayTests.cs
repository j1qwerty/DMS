using RecordRoom.Api.Application;
using RecordRoom.Api.Domain;

namespace RecordRoom.Api.Tests;

/// <summary>
/// The status strings the API returns are part of the contract the frontend
/// binds to. A rename here silently breaks every status badge in the UI, so the
/// exact wire values are pinned rather than derived from <c>ToString()</c>.
/// </summary>
public class DisplayTests
{
    [Theory]
    [InlineData(RecordStatus.Available, "Available")]
    [InlineData(RecordStatus.Issued, "Issued")]
    [InlineData(RecordStatus.UnderDigitization, "Under Digitization")]
    [InlineData(RecordStatus.Missing, "Missing")]
    [InlineData(RecordStatus.Archived, "Archived")]
    public void Record_status_uses_the_contract_spelling(RecordStatus status, string expected) =>
        Assert.Equal(expected, Display.Record(status));

    [Theory]
    [InlineData(IssueStatus.Issued, "Issued")]
    [InlineData(IssueStatus.Returned, "Returned")]
    [InlineData(IssueStatus.Overdue, "Overdue")]
    [InlineData(IssueStatus.PartiallyReturned, "Partially returned")]
    public void Issue_status_uses_the_contract_spelling(IssueStatus status, string expected) =>
        Assert.Equal(expected, Display.Issue(status));

    [Theory]
    [InlineData(PageStatus.PendingReview, "Pending review")]
    [InlineData(PageStatus.Approved, "Approved")]
    [InlineData(PageStatus.Rejected, "Rejected")]
    [InlineData(PageStatus.Duplicate, "Duplicate")]
    public void Page_status_uses_the_contract_spelling(PageStatus status, string expected) =>
        Assert.Equal(expected, Display.Page(status));

    [Theory]
    [InlineData(MovementKind.LocationChange, "Location change")]
    [InlineData(MovementKind.FileCreated, "File created")]
    [InlineData(MovementKind.Issue, "Issue")]
    [InlineData(MovementKind.Return, "Return")]
    public void Movement_kind_uses_readable_text(MovementKind kind, string expected) =>
        Assert.Equal(expected, Display.Movement(kind));

    [Theory]
    [InlineData(RecordStatus.Available)]
    [InlineData(RecordStatus.Issued)]
    [InlineData(RecordStatus.UnderDigitization)]
    [InlineData(RecordStatus.Missing)]
    [InlineData(RecordStatus.Archived)]
    public void Record_status_round_trips(RecordStatus status) =>
        // Whatever the API emits must be accepted back as a filter, or a user
        // clicking a status chip to filter by it would get nothing.
        Assert.Equal(status, Display.ParseRecord(Display.Record(status)));

    [Theory]
    [InlineData(IssueStatus.Issued)]
    [InlineData(IssueStatus.Returned)]
    [InlineData(IssueStatus.Overdue)]
    [InlineData(IssueStatus.PartiallyReturned)]
    public void Issue_status_round_trips(IssueStatus status) =>
        Assert.Equal(status, Display.ParseIssue(Display.Issue(status)));

    [Theory]
    [InlineData(PageStatus.PendingReview)]
    [InlineData(PageStatus.Approved)]
    [InlineData(PageStatus.Rejected)]
    [InlineData(PageStatus.Duplicate)]
    [InlineData(PageStatus.Active)]
    public void Page_status_round_trips(PageStatus status) =>
        Assert.Equal(status, Display.ParsePage(Display.Page(status)));

    [Theory]
    [InlineData(MovementKind.Issue)]
    [InlineData(MovementKind.Return)]
    [InlineData(MovementKind.LocationChange)]
    [InlineData(MovementKind.FileCreated)]
    public void Movement_kind_round_trips(MovementKind kind) =>
        Assert.Equal(kind, Display.ParseMovement(Display.Movement(kind)));

    [Theory]
    [InlineData(CustodyDirection.In, "Intake")]
    [InlineData(CustodyDirection.Out, "Return")]
    public void Custody_direction_uses_the_contract_spelling(CustodyDirection direction, string expected) =>
        Assert.Equal(expected, Display.Custody(direction));

    [Theory]
    [InlineData(CustodyDirection.In)]
    [InlineData(CustodyDirection.Out)]
    public void Custody_direction_round_trips(CustodyDirection direction) =>
        Assert.Equal(direction, Display.ParseCustody(Display.Custody(direction)));

    [Theory]
    [InlineData("All")]
    [InlineData("")]
    [InlineData(null)]
    public void A_blank_filter_means_no_filter_not_a_default_value(string? value)
    {
        // "All" is what the UI sends for an unset dropdown. Treating it as a
        // literal status name would silently filter everything out.
        Assert.Null(Display.ParseRecord(value));
        Assert.Null(Display.ParseIssue(value));
        Assert.Null(Display.ParsePage(value));
        Assert.Null(Display.ParseCustody(value));
    }

    [Fact]
    public void An_unknown_filter_value_is_rejected_rather_than_guessed()
    {
        Assert.Null(Display.ParseRecord("Teleported"));
        Assert.Null(Display.ParseIssue("Teleported"));
        Assert.Null(Display.ParsePage("Teleported"));
        Assert.Null(Display.ParseCustody("Teleported"));
    }

    [Fact]
    public void Storage_and_employee_status_match_their_enum_names()
    {
        // These need no aliasing, so a stray rename is the only risk.
        foreach (var status in Enum.GetValues<StorageStatus>())
            Assert.Equal(status.ToString(), Display.Storage(status));

        foreach (var status in Enum.GetValues<EmployeeStatus>())
            Assert.Equal(status.ToString(), Display.Employee(status));

        foreach (var role in Enum.GetValues<Role>())
            Assert.Equal(role.ToString(), Display.Role(role));
    }
}