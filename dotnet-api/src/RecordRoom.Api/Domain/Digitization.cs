namespace RecordRoom.Api.Domain;

/// <summary>
/// A scanned page of a physical file. Keyed by file barcode + page number; a
/// re-scan stores the next <see cref="Version"/> rather than overwriting a
/// possibly-approved page. Review is per page; the Digitization section is the
/// pending-review queue across files (there are no employee batches).
/// </summary>
public class FileScanPage
{
    public long Id { get; set; }
    public required string Barcode { get; set; }
    public required string FileName { get; set; }
    public int PageNo { get; set; }
    /// <summary>Physical side of this page. Historical rows default to Front.</summary>
    public string Side { get; set; } = "Front";
    public int Version { get; set; } = 1;
    /// <summary>Physical sheet size (A0–A4, Legal, Other); same options as the file.</summary>
    public string DocumentSize { get; set; } = "Other";
    public PageStatus Status { get; set; } = PageStatus.PendingReview;
    public string Note { get; set; } = string.Empty;
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    public string UploadedBy { get; set; } = string.Empty;
    public string? StorageKey { get; set; }
    public string? ContentType { get; set; }
    public long? SizeBytes { get; set; }
    public string? Sha256 { get; set; }
    /// <summary>Pages in the stored PDF; null for images or an unreadable page tree.</summary>
    public int? PageCount { get; set; }
    /// <summary>1-based page within a multi-page PDF that this row represents.</summary>
    public int? PageIndex { get; set; }

    /// <summary>OCR extraction state; the engine is selected and operated separately.</summary>
    public string OcrStatus { get; set; } = "NotProcessed";
    /// <summary>Plain text extracted from this scan page; never used as an OCR confidence claim.</summary>
    public string? OcrText { get; set; }
    public string? OcrLanguage { get; set; }
    public string? OcrEngine { get; set; }
    public string? OcrError { get; set; }
    public DateTime? OcrUpdatedAt { get; set; }
    public string? OcrUpdatedBy { get; set; }

    public RecordFile? RecordFile { get; set; }
}

/// <summary>Legacy <c>upload_map</c> — scanned maps and file copies.</summary>
public class MapUpload
{
    public long Id { get; set; }
    public required string Barcode { get; set; }
    public required string FileName { get; set; }
    public int PageNo { get; set; }
    public int Version { get; set; } = 1;
    public PageStatus Status { get; set; } = PageStatus.PendingReview;
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    public string UploadedBy { get; set; } = string.Empty;
    public int SizeKb { get; set; }
    public string? StorageKey { get; set; }
    public string? ContentType { get; set; }
    public long? SizeBytes { get; set; }
    public string? Sha256 { get; set; }
    /// <summary>Pages in the stored PDF; null for images or an unreadable page tree.</summary>
    public int? PageCount { get; set; }
    /// <summary>1-based page within a multi-page PDF that this row represents.</summary>
    public int? PageIndex { get; set; }

    public RecordFile? RecordFile { get; set; }
}

public class BulkImportJob
{
    public long Id { get; set; }
    public required string FileName { get; set; }
    public string Folder { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = string.Empty;
    public string Status { get; set; } = "Validated";
    public int Accepted { get; set; }
    public int Rejected { get; set; }
    public int Duplicates { get; set; }

    public List<BulkImportRow> Rows { get; set; } = [];
}

public class BulkImportRow
{
    public long Id { get; set; }
    public long JobId { get; set; }
    public int RowNo { get; set; }
    public string Barcode { get; set; } = string.Empty;
    public string Subject { get; set; } = string.Empty;
    public string ShelfBarcode { get; set; } = string.Empty;
    public required string Result { get; set; }
    public string Detail { get; set; } = string.Empty;

    public BulkImportJob? Job { get; set; }
}

public class BarcodeJob
{
    public long Id { get; set; }
    public required BarcodeSubject Subject { get; set; }
    public required string TargetId { get; set; }
    public required string Label { get; set; }
    public required string Value { get; set; }
    public int Quantity { get; set; }
    public string RequestedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string Status { get; set; } = "Queued";
}

public class Inquiry
{
    public long Id { get; set; }
    public required string Name { get; set; }
    public required string Email { get; set; }
    public string Department { get; set; } = string.Empty;
    public required string Message { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string Source { get; set; } = "record-room-frontend";
}

public class MediaLink
{
    public long Id { get; set; }
    public required string Title { get; set; }
    public required string Url { get; set; }
    public required string Alt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string Source { get; set; } = "record-room-frontend";
}

/// <summary>
/// One custody handover in the digitization chain (work plan §3.8): "In" is an
/// intake — a department's files received and counted for digitization; "Out"
/// is the return / digital-handover sign-off back to the department. Rows are
/// immutable: corrections are new events, never edits. The difference between
/// the declared and reconciled count on the intake side is the
/// count-reconciliation the tender's counting step implies.
/// </summary>
public class CustodyEvent
{
    public long Id { get; set; }
    public CustodyDirection Direction { get; set; } = CustodyDirection.In;
    /// <summary>Free-text digitization batch / reference the handover is tied to.</summary>
    public string BatchRef { get; set; } = string.Empty;
    public required string Department { get; set; }
    public string Vendor { get; set; } = string.Empty;
    /// <summary>Files declared by the department (intake) or leaving the room (return).</summary>
    public int FileCount { get; set; }
    /// <summary>Files actually counted; null until the intake side is reconciled.</summary>
    public int? ReconciledCount { get; set; }
    public string RecordedBy { get; set; } = string.Empty;
    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;
    public string? SignedOffBy { get; set; }
    public DateTime? SignedOffAt { get; set; }
    public string Remarks { get; set; } = string.Empty;
}

/// <summary>
/// Immutable digital deliverables handover. The manifest snapshots the file
/// identity, final-PDF version, page count and SHA-256 values at preparation.
/// Later file edits cannot silently rewrite what was handed to the Department.
/// </summary>
public class DigitalHandoverBatch
{
    public long Id { get; set; }
    public required string BatchRef { get; set; }
    public required string Department { get; set; }
    public string Notes { get; set; } = string.Empty;
    public string Status { get; set; } = "Prepared";
    public required string ManifestJson { get; set; }
    public required string ManifestSha256 { get; set; }
    public required string PreparedBy { get; set; }
    public DateTime PreparedAt { get; set; } = DateTime.UtcNow;
    public string? DeliveredBy { get; set; }
    public DateTime? DeliveredAt { get; set; }
    public string? SignedOffBy { get; set; }
    public DateTime? SignedOffAt { get; set; }
    public string DecisionNotes { get; set; } = string.Empty;
    public List<DigitalHandoverItem> Items { get; set; } = [];
}

/// <summary>A checksum-protected final PDF included in a prepared handover.</summary>
public class DigitalHandoverItem
{
    public long Id { get; set; }
    public long DigitalHandoverBatchId { get; set; }
    public int RecordFileId { get; set; }
    public long RecordFileDocumentId { get; set; }
    public required string FileNumber { get; set; }
    public required string Department { get; set; }
    public required string FileName { get; set; }
    public int Version { get; set; }
    public required string ContentType { get; set; }
    public long SizeBytes { get; set; }
    public int? PageCount { get; set; }
    public required string Sha256 { get; set; }
    public DigitalHandoverBatch? Batch { get; set; }
    public RecordFile? RecordFile { get; set; }
    public RecordFileDocument? Document { get; set; }
}
