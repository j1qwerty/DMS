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
    string? EOfficeReference = null,
    /// <summary>"ocr" when a search matched this file only through the OCR text of its digitized pages.</summary>
    string? MatchedVia = null);

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
    // Scan studio (§3.4) + quality gates (§3.2)
    int OrderIndex = 0,
    int? Dpi = null,
    string? Enhancement = null,
    bool HasProcessed = false,
    string? OcrText = null);

public sealed record ScanAddInput(string FileName, int PageNo, string? DocumentSize = null, string? Note = null);
public sealed record PageReviewInput(string Decision, string Note = "");

/// <summary>Body of POST /api/files/{fileId}/scans/review-set: the reviewer's page selection decided in one call.</summary>
public sealed record PageSetReviewInput(long[] ScanIds, string Decision, string Note = "");

/// <summary>Body of PUT /api/files/{fileId}/scans/order: the studio's persisted page order.</summary>
public sealed record ScanOrderInput(long[] ScanIds);

/// <summary>Body of POST /api/scans/{id}/rotate.</summary>
public sealed record ScanRotateInput(int Degrees);

/// <summary>Body of POST /api/scans/{id}/enhance. Operation: deskew | despeckle | binarize | crop | contrast.</summary>
public sealed record ScanEnhanceInput(string Operation);

/// <summary>A generated deliverable (PDF built from the file's ordered approved pages).</summary>
public sealed record DocumentDerivativeDto(
    long Id,
    int FileId,
    string FileBarcode,
    string Kind,
    string FileName,
    long? SizeBytes,
    string? Sha256,
    int PageCount,
    string SourceVersions,
    bool IncludesOcrText,
    DateTime CreatedAt,
    string CreatedBy,
    string? FileNumber = null,
    string Status = "Pending approval",
    string? ReviewedBy = null,
    DateTime? ReviewedAt = null,
    string? ReviewNote = null);

/// <summary>Body of POST /api/files/{fileId}/pdf — builds the deliverable from approved pages.</summary>
public sealed record DeliverablePdfInput(string? FileName = null, string? Remarks = null);

/// <summary>
/// Body of POST /api/files/{fileId}/pdf/{derivativeId}/review — the reviewer's
/// verdict on a freshly built deliverable. A rejection requires a reason.
/// </summary>
public sealed record DeliverableReviewInput(string Decision, string? Note = null);

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
    /// <summary>Who ran the reconciliation count, and when (intakes only).</summary>
    string? ReconciledBy,
    DateTime? ReconciledAt,
    /// <summary>Files already returned against this intake (intakes only; 0 until a return lands).</summary>
    int ReturnedCount,
    /// <summary>The intake a return was recorded against, when it was.</summary>
    long? SourceCustodyId,
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
public sealed record CustodyReturnAgainstInput(int FileCount, string Remarks = "");

// Departments ------------------------------------------------------------------

public sealed record DepartmentDto(
    int Id,
    string Name,
    string Code,
    string Remarks,
    /// <summary>Employees currently filed under the department (blocks deletion when > 0).</summary>
    int EmployeeCount,
    DateTime CreatedAt);

public sealed record DepartmentInput(string Name, string Code, string Remarks = "");

// OCR ---------------------------------------------------------------------------

public sealed record ScanOcrDto(
    long ScanId,
    string Barcode,
    int PageNo,
    int Version,
    string OcrText,
    /// <summary>"pdf-text-layer", "tesseract hin+eng" or "none" — what produced the text.</summary>
    string Method,
    DateTime RanAt);

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
    int? PageCount = null);

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
    int PendingApprovals);

public sealed record ActivityDto(string Id, string Label, string Date, string Actor, string Detail, string Tone);

// Inquiries and media ---------------------------------------------------------

public sealed record InquiryInput(string Name, string Email, string Department, string Message);
public sealed record InquiryDto(long Id, string Name, string Email, string Department, string Message, DateTime CreatedAt);
public sealed record MediaLinkInput(string Title, string Url, string Alt);
public sealed record MediaLinkDto(long Id, string Title, string Url, string Alt, DateTime CreatedAt);

// Misc ------------------------------------------------------------------------

/// <summary>Served at GET /api/config so the frontend knows which optional features are on.</summary>
public sealed record FeaturesDto(bool Barcode, bool RecordRoom, bool Maps, bool Support);

/// <summary>
/// Served at GET /api/config so the frontend knows which optional features are on.
/// <c>SettingsEditable</c> is false when the deployment locked the feature
/// switchboard through its environment (<c>Settings:AllowFeatureEditing=false</c>) —
/// the Settings page then shows the switches read-only instead of failing on save.
/// <c>DemoMode</c> tells the UI the registry is running on the demo dataset.
/// </summary>
public sealed record AppConfigDto(
    string AppName,
    FeaturesDto Features,
    bool SettingsEditable,
    bool DemoMode,
    OcrStatusDto Ocr);

/// <summary>One line of truth about the OCR engine, shown on the OCR screen.</summary>
public sealed record OcrStatusDto(
    bool Enabled,
    bool Available,
    string Engine,
    string Languages,
    string Note);

public sealed record HealthDto(string Status, string Database, bool Redis, string Hangfire, DateTime At);
public sealed record JobAcceptedDto(string JobId, string Queue);

// Feature visibility (ZILA_PANCHAYAT_CC §F) ------------------------------------

/// <summary>One feature group's live state, as shown in Settings → Feature visibility.</summary>
public sealed record FeatureSettingDto(string Key, bool Enabled, string UpdatedBy, DateTime UpdatedAt);

/// <summary>Only the listed keys change; unknown keys are refused, not ignored.</summary>
public sealed record FeatureUpdateInput(Dictionary<string, bool> Features);

// Permission matrix (§3.7) ------------------------------------------------------

/// <summary>The whole editable capability matrix: the permission catalogue plus, per role, the granted cells.</summary>
public sealed record PermissionMatrixDto(string[] Permissions, PermissionMatrixRowDto[] Roles);
public sealed record PermissionMatrixRowDto(string Role, string[] Permissions);

/// <summary>Single-cell update: granting or revoking one permission for one role.</summary>
public sealed record PermissionGrantInput(bool Granted);