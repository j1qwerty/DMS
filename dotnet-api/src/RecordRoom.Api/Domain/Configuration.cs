namespace RecordRoom.Api.Domain;

/// <summary>
/// One row per feature group (work plan §F, ZILA_PANCHAYAT_CC). Rows are the
/// deployment's live choice: the Admin toggles them at
/// <c>PUT /api/config/features</c> and the API starts or stops serving the
/// group's endpoints immediately — features are hidden, never removed, so a
/// later engagement can switch a group back on without a redeploy.
/// Absent rows fall back to <c>Features:{Key}Enabled</c> configuration.
/// </summary>
public class FeatureSetting
{
    public long Id { get; set; }
    /// <summary>Group key: <c>barcode</c>, <c>recordRoom</c>, <c>maps</c>, <c>support</c>.</summary>
    public required string FeatureKey { get; set; }
    public bool Enabled { get; set; }
    public string UpdatedBy { get; set; } = string.Empty;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// The editable capability matrix (work plan §3.7, design doc
/// <c>V2-EDITABLE-PERMISSIONS.md</c>): present rows mean granted, absence
/// means not granted, so a permission invented later needs no migration. The
/// Admin row is fixed server-side and the last <c>users.edit</c> holder can
/// never be revoked, so the matrix cannot lock the deployment out of itself.
/// </summary>
public class RolePermission
{
    public long Id { get; set; }
    /// <summary>Role name as it appears in tokens (<c>Admin</c>, <c>Supervisor</c>, <c>Operator</c>, <c>Employee</c>).</summary>
    public required string Role { get; set; }
    /// <summary>Permission key, e.g. <c>files.view</c>, <c>digitization.review</c>.</summary>
    public required string Permission { get; set; }
    public string GrantedBy { get; set; } = string.Empty;
    public DateTime GrantedAt { get; set; } = DateTime.UtcNow;
}
