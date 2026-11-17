using RecordRoom.Api.Domain;

namespace RecordRoom.Api.Application;

/// <summary>
/// Maps domain enums to the status strings the frontend contract expects
/// (<c>services/contracts.ts</c>).
///
/// The raw enum names are more consistent for storage and filtering, so the
/// conversion happens once, at the DTO boundary, rather than renaming the
/// enums and losing that.
/// </summary>
public static class Display
{
    public static string Record(RecordStatus status) => status switch
    {
        RecordStatus.UnderDigitization => "Under Digitization",
        _ => status.ToString(),
    };

    public static string Issue(IssueStatus status) => status switch
    {
        IssueStatus.PartiallyReturned => "Partially returned",
        _ => status.ToString(),
    };

    public static string Page(PageStatus status) => status switch
    {
        PageStatus.PendingReview => "Pending review",
        _ => status.ToString(),
    };

    public static string Custody(CustodyDirection direction) => direction switch
    {
        CustodyDirection.In => "Intake",
        CustodyDirection.Out => "Return",
        _ => direction.ToString(),
    };

    public static string Movement(MovementKind kind) => kind switch
    {
        MovementKind.LocationChange => "Location change",
        MovementKind.FileCreated => "File created",
        _ => kind.ToString(),
    };

    public static string FileKind(FileKind kind) => kind.ToString();
    public static string Storage(StorageStatus status) => status.ToString();
    public static string Employee(EmployeeStatus status) => status.ToString();
    public static string Role(Role role) => role.ToString();

    /// <summary>Parses a contract status string back into an enum, tolerating either spelling.</summary>
    public static RecordStatus? ParseRecord(string? value) => value switch
    {
        null or "" or "All" => null,
        "Under Digitization" => RecordStatus.UnderDigitization,
        _ => Enum.TryParse<RecordStatus>(value, true, out var parsed) ? parsed : null,
    };

    public static IssueStatus? ParseIssue(string? value) => value switch
    {
        null or "" or "All" => null,
        "Partially returned" => IssueStatus.PartiallyReturned,
        _ => Enum.TryParse<IssueStatus>(value, true, out var parsed) ? parsed : null,
    };

    public static PageStatus? ParsePage(string? value) => value switch
    {
        null or "" or "All" => null,
        "Pending review" => PageStatus.PendingReview,
        _ => Enum.TryParse<PageStatus>(value, true, out var parsed) ? parsed : null,
    };

    public static CustodyDirection? ParseCustody(string? value) => value switch
    {
        null or "" or "All" => null,
        "Intake" => CustodyDirection.In,
        "Return" => CustodyDirection.Out,
        _ => Enum.TryParse<CustodyDirection>(value, true, out var parsed) ? parsed : null,
    };

    public static MovementKind? ParseMovement(string? value) => value switch
    {
        "Location change" => MovementKind.LocationChange,
        "File created" => MovementKind.FileCreated,
        _ => Enum.TryParse<MovementKind>(value, true, out var parsed) ? parsed : null,
    };
}