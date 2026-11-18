using RecordRoom.Api.Domain;

namespace RecordRoom.Api.Application.Contracts;

// Auth ------------------------------------------------------------------------

public sealed record LoginRequest(string UserName, string Password);
public sealed record OtpRequest(string UserName);
public sealed record OtpVerifyRequest(string UserName, string Otp);
public sealed record PinLoginRequest(string UserName, string Pin);
public sealed record RecoveryCompleteRequest(string UserName, string Otp, string Password);

public sealed record AuthTokenResponse(
    string Token,
    DateTime ExpiresAt,
    UserDto User,
    string[] Permissions);

public sealed record OtpChallengeResponse(string ChallengeId, DateTime ExpiresAt);

public sealed record UserDto(
    int Id,
    string UserName,
    string DisplayName,
    string Role,
    string? EmployeeCode,
    bool Active,
    DateTime LastLoginAt);

public sealed record UserInput(
    string UserName,
    string DisplayName,
    string Role,
    string? EmployeeCode,
    bool Active);

/// <summary>Asks for a recovery code. Only the user name is needed.</summary>
public sealed record RecoveryRequest(string UserName);

/// <summary>Completes a reset by pairing the issued code with the new password.</summary>
public sealed record PasswordResetRequest(string UserName, string Otp, string Password);

// Locations -------------------------------------------------------------------

public sealed record AreaDto(int Id, string Name, string Pincode, bool Active);

public sealed record ShelfDto(
    int Id,
    string Code,
    string Name,
    string Barcode,
    string Status,
    int Capacity,
    int Occupied,
    int Position,
    int FileCount);

public sealed record StorageUnitDto(
    int Id,
    string Code,
    string Name,
    string Type,
    string Barcode,
    string Status,
    decimal X,
    decimal Y,
    decimal Width,
    decimal Height,
    ShelfDto[] Shelves);

public sealed record SectionDto(
    int Id,
    int RoomId,
    string Code,
    string Name,
    string Status,
    StorageUnitDto[] StorageUnits);

public sealed record RoomDto(
    int Id,
    string Code,
    string Name,
    string Building,
    string Floor,
    int Occupancy,
    int Capacity,
    string Status,
    SectionDto[] Sections,
    StorageUnitDto[] StorageUnits);

/// <summary>Add or edit a room. Only <c>Name</c> is required on create.</summary>
public sealed record RoomInput(
    string Name,
    string? Building = null,
    string? Floor = null,
    string? Status = null,
    int? Capacity = null);

public sealed record SectionInput(string Name, string? Status = null);
public sealed record AlmirahInput(
    string Code,
    string Name,
    string? Barcode = null,
    string Type = "Almirah",
    decimal X = 12,
    decimal Y = 10,
    decimal Width = 20,
    decimal Height = 76);
public sealed record ShelfInput(string Code, string Name, string Barcode, int Capacity = 80, string? Status = null);
public sealed record StatusInput(string Status);
public sealed record LayoutSaveInput(string Note);
public sealed record LayoutRevisionDto(int Revision, string Note, DateTime At, string Actor);

// Files -----------------------------------------------------------------------

public sealed record FileDto(
    int Id,
    string FileBarcode,
    string FileNumber,
    string Subject,
    string Department,
    int Year,
    string FileType,
    string Status,
    string Location,
    int? RoomId,
    int? SectionId,
    int? AlmirahId,
    int? ShelfId,
    string Section,
    string Almirah,
    string Shelf,
    string ShelfBarcode,
    int Position,
    string Pincode,
    string Area,
    string PropertyNo,
    string PropertyArea,
    string Dealer,
    string CodalLife,
    DateTime CreatedAt,
    string CreatedBy,
    DateTime UpdatedAt,
    string UpdatedBy,
    string LastMovement,
    string? Holder,
    string? HolderEmployeeCode,
    string Description,
    string? RecordKind = null,
    string? DocumentSize = null,
    string? EOfficeReference = null);

public sealed record FileCreateInput(
    string FileBarcode,
    string Subject,
    string Department,
    int Year,
    string FileType,
    int? ShelfId,
    int Position,
    string Pincode,
    string Area,
    string PropertyNo,
    string PropertyArea,
    string Dealer,
    string CodalLife,
    string Description,
    string? RecordKind = null,
    string DocumentSize = "Other",
    string? EOfficeReference = null);

public sealed record RelocateInput(int ShelfId, int Position, string Reason);
public sealed record EOfficeReferenceInput(string? EOfficeReference);

/// <summary>
/// Paged envelope. <c>collectionTotal</c> is the true registry size so the UI can
/// say "1-10 of 2,478,450" honestly instead of implying it holds every row.
/// </summary>
public sealed record PagedResult<T>(T[] Items, int Total, int Page, int PageSize, long CollectionTotal);

// Issues ----------------------------------------------------------------------

public sealed record IssueLineDto(long Id, int FileId, string FileBarcode, DateTime? ReturnedAt, string ReturnCondition, string? FileNumber = null);
public sealed record IssueDto(
    long Id,
    string ReceiptNumber,
    string BorrowerType,
    string BorrowerName,
    string BorrowerEmployeeCode,
    string Department,
    string Purpose,
    IssueLineDto[] Lines,
    DateTime IssuedAt,
    DateTime DueAt,
    DateTime? ReturnedAt,
    string Status,
    string Remark,
    string IssuedBy);

public sealed record IssueInput(
    string BorrowerType,
    string BorrowerEmployeeCode,
    string BorrowerName,
    string Department,
    string Purpose,
    int[] FileIds,
    DateTime DueAt,
    string Remark);

public sealed record ReturnInput(int[] FileIds, string Condition);

public sealed record BorrowerDto(
    string EmployeeCode,
    string Name,
    string Department,
    int OpenFiles,
    DateTime OldestDue,
    bool Overdue);

// Movement --------------------------------------------------------------------

public sealed record MovementDto(
    long Id,
    string Kind,
    int FileId,
    string FileBarcode,
    string Subject,
    string From,
    string To,
    string Actor,
    DateTime At,
    string Detail,
    long? IssueId,
    string? FileNumber = null);

// Employees -------------------------------------------------------------------

public sealed record EmployeeDto(
    int Id,
    string EmployeeCode,
    string Prefix,
    string Name,
    string FatherName,
    string Gender,
    string? DateOfBirth,
    string Department,
    string Designation,
    string Email,
    string Mobile,
    string Pan,
    string Aadhaar,
    string Role,
    string GradePay,
    string PayScale,
    string Status,
    DateTime CreatedAt,
    DateTime ModifiedAt);

public sealed record EmployeeInput(
    string EmployeeCode,
    string Prefix,
    string Name,
    string FatherName,
    string Gender,
    string? DateOfBirth,
    string Department,
    string Designation,
    string Email,
    string Mobile,
    string Pan,
    string Aadhaar,
    string Role,
    string GradePay,
    string PayScale,
    string Status);

// Digitization ----------------------------------------------------------------

/// <summary>
/// One scanned page of a file (page-by-page digitization). There are no
/// employee batches — scans live on the file, review is per page, and the
/// Digitization section is the pending-review queue across files.
/// </summary>
public sealed record FileScanPageDto(
    long Id,
    int FileId,
    string FileBarcode,
    string FileName,
    int PageNo,
    int Version,
    string DocumentSize,
    string Status,
    string Note,
    DateTime UploadedAt,
    string UploadedBy,
    bool HasDocument = false,
    string? ContentType = null,
    long? SizeBytes = null,
    string? Sha256 = null,
    int? PageCount = null,
    int? PageIndex = null,
    string? FileNumber = null,
    string Side = "Front",
    string OcrStatus = "NotProcessed",
    bool HasOcrText = false,
    string? OcrLanguage = null,
    string? OcrEngine = null,
    DateTime? OcrUpdatedAt = null,
    string? OcrUpdatedBy = null);

public sealed record ScanOcrInput(
    string Status,
    string Text = "",
    string? Language = null,
    string? Engine = null,
    string? Error = null);

public sealed record ScanOcrDto(
    long ScanId,
    int FileId,
    int PageNo,
    string Side,
    int Version,
    string Status,
    string Text,
    string? Language,
    string? Engine,
    string? Error,
    DateTime? UpdatedAt,
    string? UpdatedBy);

public sealed record ScanAddInput(string FileName, int PageNo, string? DocumentSize = null, string? Note = null, string? Side = null);
public sealed record PageReviewInput(string Decision, string Note = "");

// Custody chain (§3.8) ---------------------------------------------------------

/// <summary>
/// One handover in the digitization custody chain: an intake ("In" — files
/// received and counted) or a return ("Out" — files handed back with sign-off).
/// </summary>
public sealed record CustodyEventDto(
    long Id,
    string Direction,
    string BatchRef,
    string Department,
    string Vendor,
    int FileCount,
    int? ReconciledCount,
    string RecordedBy,
    DateTime RecordedAt,
    string? SignedOffBy,
    DateTime? SignedOffAt,
    string Remarks);

public sealed record CustodyQuery(
    string? Direction = null,
    string? Search = null,
    int Page = 1,
    int PageSize = 20);

public sealed record CustodyRecordInput(
    string Direction,
    string Department,
    int FileCount,
    string BatchRef = "",
    string Vendor = "",
    string Remarks = "");

public sealed record CustodyReconcileInput(int ReconciledCount, string Remarks = "");
public sealed record CustodySignOffInput(string SignedOffBy = "");

// Digital deliverables handover ----------------------------------------------

public sealed record DigitalHandoverPrepareInput(
    string BatchRef,
    string Department,
    int[] FileIds,
    string Notes = "");

public sealed record DigitalHandoverSignOffInput(
    string Decision,
    string SignedOffBy,
    string Notes = "");

public sealed record DigitalHandoverItemDto(
    long Id,
    int FileId,
    long DocumentId,
    string FileNumber,
    string Department,
    string FileName,
    int Version,
    string ContentType,
    long SizeBytes,
    int? PageCount,
    string Sha256);

public sealed record DigitalHandoverBatchDto(
    long Id,
    string BatchRef,
    string Department,
    string Notes,
    string Status,
    string ManifestSha256,
    int ItemCount,
    string PreparedBy,
    DateTime PreparedAt,
    string? DeliveredBy,
    DateTime? DeliveredAt,
    string? SignedOffBy,
    DateTime? SignedOffAt,
    string DecisionNotes,
    DigitalHandoverItemDto[] Items);

public sealed record DigitalHandoverPackage(Stream Content, string FileName, string Sha256);

// Uploads ---------------------------------------------------------------------

public sealed record MapUploadDto(
    long Id,
    string FileBarcode,
    string FileName,
    int PageNo,
    int Version,
    string Status,
    DateTime UploadedAt,
    string UploadedBy,
    int SizeKb,
    bool HasDocument = false,
    string? ContentType = null,
    long? SizeBytes = null,
    string? Sha256 = null,
    int? PageCount = null,
    int? PageIndex = null,
    string? FileNumber = null,
    int? FileId = null);

public sealed record MapUploadInput(string FileBarcode, int PageNo, string FileName, int SizeKb);

public sealed record RecordFileDocumentDto(
    long Id, int FileId, string FileBarcode, int Version, string FileName,
    string ContentType, long SizeBytes, string Sha256, DateTime UploadedAt, string UploadedBy,
    int? PageCount = null,
    string DocumentKind = "Attachment");

// Bulk ------------------------------------------------------------------------

public sealed record BulkRowDto(int RowNo, string FileBarcode, string Subject, string ShelfBarcode, string Result, string Detail);
public sealed record BulkJobDto(
    long Id,
    string FileName,
    string Folder,
    DateTime CreatedAt,
    string CreatedBy,
    string Status,
    BulkRowDto[] Rows,
    int Accepted,
    int Rejected,
    int Duplicates);

public sealed record BulkValidateInput(string Csv, string Folder);

// Barcodes --------------------------------------------------------------------

public sealed record BarcodePayloadDto(
    string Subject,
    string Symbology,
    string Value,
    string Label,
    string Meta,
    bool Valid,
    string? Reason);

public sealed record BarcodeJobDto(
    long Id,
    string Subject,
    string TargetId,
    string Label,
    string Value,
    int Quantity,
    string RequestedBy,
    DateTime CreatedAt,
    string Status);

public sealed record BarcodeJobInput(string Subject, string TargetId, int Quantity);
public sealed record BarcodeValidateInput(string Value);
public sealed record BarcodeValidateResponse(bool Ok, BarcodePayloadDto? Payload, string Message);

// Reports ---------------------------------------------------------------------

public sealed record ReportDefinitionDto(string Key, string Title, string Description, string[] Columns, string LegacySource);
public sealed record ReportResultDto(
    string Key,
    string Title,
    string[] Columns,
    object[][] Rows,
    DateTime GeneratedAt,
    int RowCount);

// Dashboard -------------------------------------------------------------------

public sealed record DashboardStatsDto(
    long TotalRecords,
    double MappedPercent,
    int IssuedNow,
    int DueToday,
    double DigitizationPercent,
    int OverdueCount,
    int RoomCount,
    int ActiveBorrowers,
    int PendingApprovals,
    bool MappedBaselineConfigured,
    bool DigitizationBaselineConfigured);

public sealed record ActivityDto(string Id, string Label, string Date, string Actor, string Detail, string Tone);

// Inquiries and media ---------------------------------------------------------

public sealed record InquiryInput(string Name, string Email, string Department, string Message);
public sealed record InquiryDto(long Id, string Name, string Email, string Department, string Message, DateTime CreatedAt);
public sealed record MediaLinkInput(string Title, string Url, string Alt);
public sealed record MediaLinkDto(long Id, string Title, string Url, string Alt, DateTime CreatedAt);

// Misc ------------------------------------------------------------------------

/// <summary>Served at GET /api/config so the frontend knows which optional features are on.</summary>
public sealed record FeaturesDto(bool Barcode, bool Movement = false, bool Support = false, bool BulkImport = false);
public sealed record AppConfigDto(string AppName, FeaturesDto Features);

public sealed record HealthDto(string Status, string Database, bool Redis, string Hangfire, DateTime At);
public sealed record JobAcceptedDto(string JobId, string Queue);