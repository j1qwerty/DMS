using Microsoft.EntityFrameworkCore;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Auth;
using RecordRoom.Api.Infrastructure.Data;

namespace RecordRoom.Api.Application.Services;

/// <summary>
/// The digitization custody chain (work plan §3.8): an intake register ("In" —
/// a department's files received and counted) and a return / handover sign-off
/// ("Out"), both recorded the same way. Rows are immutable — corrections are
/// new events, never edits — and every write lands in the audit trail.
/// </summary>
public interface ICustodyService
{
    Task<PagedResult<CustodyEventDto>> ListAsync(CustodyQuery query, CancellationToken ct = default);
    Task<Result<CustodyEventDto>> RecordAsync(CustodyRecordInput input, CancellationToken ct = default);
    Task<Result<CustodyEventDto>> ReconcileAsync(long id, CustodyReconcileInput input, CancellationToken ct = default);
    Task<Result<CustodyEventDto>> SignOffAsync(long id, CustodySignOffInput input, CancellationToken ct = default);
}

public sealed class CustodyService(
    AppDbContext db,
    IAuditWriter audit,
    ICurrentUserAccessor current) : ICustodyService
{
    private const int MaxPageSize = 100;

    private static CustodyEventDto ToDto(CustodyEvent e) => new(
        e.Id, Display.Custody(e.Direction), e.BatchRef, e.Department, e.Vendor,
        e.FileCount, e.ReconciledCount, e.RecordedBy, e.RecordedAt,
        e.SignedOffBy, e.SignedOffAt, e.Remarks);

    public async Task<PagedResult<CustodyEventDto>> ListAsync(CustodyQuery query, CancellationToken ct = default)
    {
        var pages = db.CustodyEvents.AsNoTracking().AsQueryable();

        if (Display.ParseCustody(query.Direction) is { } direction)
            pages = pages.Where(e => e.Direction == direction);

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var needle = query.Search.Trim();
            pages = pages.Where(e =>
                e.Department.Contains(needle)
                || e.BatchRef.Contains(needle)
                || e.Vendor.Contains(needle)
                || e.RecordedBy.Contains(needle)
                || e.Remarks.Contains(needle));
        }

        var total = await pages.CountAsync(ct);
        var pageSize = Math.Clamp(query.PageSize, 1, MaxPageSize);
        var page = Math.Max(query.Page, 1);
        var items = await pages
            .OrderByDescending(e => e.RecordedAt)
            .ThenByDescending(e => e.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        // The register is small, so collectionTotal is the true filtered size —
        // the UI shows "1-N of total" honestly, with no legacy fallback figure.
        return new PagedResult<CustodyEventDto>(
            items.Select(ToDto).ToArray(), total, page, pageSize, total);
    }

    public async Task<Result<CustodyEventDto>> RecordAsync(CustodyRecordInput input, CancellationToken ct = default)
    {
        var department = input.Department.Trim();
        if (department.Length == 0)
            return Result<CustodyEventDto>.Fail("Department is required.", "department");

        if (input.FileCount < 1)
            return Result<CustodyEventDto>.Fail("File count must be at least 1.", "fileCount");

        if (Display.ParseCustody(input.Direction) is not { } direction)
            return Result<CustodyEventDto>.Fail("Direction must be Intake or Return.", "direction");

        var actor = current.User?.DisplayName ?? current.UserName;
        var custody = new CustodyEvent
        {
            Direction = direction,
            BatchRef = input.BatchRef.Trim(),
            Department = department,
            Vendor = input.Vendor.Trim(),
            FileCount = input.FileCount,
            RecordedBy = actor,
            Remarks = input.Remarks.Trim(),
        };
        db.CustodyEvents.Add(custody);
        await audit.LogAsync(
            db, AuditAction.Create, "CustodyEvent", "pending", "-",
            $"{Display.Custody(direction)} · {department} · {input.FileCount} file(s)",
            $"{actor} recorded {Display.Custody(direction).ToLowerInvariant()} of {input.FileCount} file(s) for {department}.",
            ct);
        await db.SaveChangesAsync(ct);
        await audit.AnnounceAsync(
            RealtimeChannels.Digitization, "custody.recorded", custody.Id.ToString(),
            $"{Display.Custody(direction)} · {department} · {input.FileCount} file(s)");
        return Result<CustodyEventDto>.Ok(ToDto(custody));
    }

    public async Task<Result<CustodyEventDto>> ReconcileAsync(long id, CustodyReconcileInput input, CancellationToken ct = default)
    {
        var custody = await db.CustodyEvents.FirstOrDefaultAsync(e => e.Id == id, ct);
        if (custody is null) return Result<CustodyEventDto>.Fail("Custody event not found.");

        // Counting is the intake step: a return handover leaves the room and is
        // closed by sign-off, not by a recount.
        if (custody.Direction != CustodyDirection.In)
            return Result<CustodyEventDto>.Fail("Only intake events are counted; returns close by sign-off.");

        if (custody.SignedOffAt is not null)
            return Result<CustodyEventDto>.Fail("This event is already signed off and can no longer be changed.");

        if (input.ReconciledCount < 0)
            return Result<CustodyEventDto>.Fail("Reconciled count cannot be negative.", "reconciledCount");

        var before = $"counted {(custody.ReconciledCount?.ToString() ?? "not yet")}";
        custody.ReconciledCount = input.ReconciledCount;
        if (!string.IsNullOrWhiteSpace(input.Remarks)) custody.Remarks = input.Remarks.Trim();

        await audit.LogAsync(
            db, AuditAction.Update, "CustodyEvent", custody.Id.ToString(), before,
            $"counted {input.ReconciledCount}",
            $"Intake for {custody.Department} reconciled: declared {custody.FileCount}, counted {input.ReconciledCount}.",
            ct);
        await db.SaveChangesAsync(ct);
        await audit.AnnounceAsync(
            RealtimeChannels.Digitization, "custody.reconciled", custody.Id.ToString(),
            $"Intake · {custody.Department} · counted {input.ReconciledCount} of {custody.FileCount}");
        return Result<CustodyEventDto>.Ok(ToDto(custody));
    }

    public async Task<Result<CustodyEventDto>> SignOffAsync(long id, CustodySignOffInput input, CancellationToken ct = default)
    {
        var custody = await db.CustodyEvents.FirstOrDefaultAsync(e => e.Id == id, ct);
        if (custody is null) return Result<CustodyEventDto>.Fail("Custody event not found.");

        if (custody.SignedOffAt is not null)
            return Result<CustodyEventDto>.Fail("This event is already signed off.");

        custody.SignedOffBy = string.IsNullOrWhiteSpace(input.SignedOffBy)
            ? current.User?.DisplayName ?? current.UserName
            : input.SignedOffBy.Trim();
        custody.SignedOffAt = DateTime.UtcNow;

        await audit.LogAsync(
            db, AuditAction.Approve, "CustodyEvent", custody.Id.ToString(),
            "not signed off", $"signed off by {custody.SignedOffBy}",
            $"{Display.Custody(custody.Direction)} for {custody.Department} signed off by {custody.SignedOffBy}.",
            ct);
        await db.SaveChangesAsync(ct);
        await audit.AnnounceAsync(
            RealtimeChannels.Digitization, "custody.signed-off", custody.Id.ToString(),
            $"{Display.Custody(custody.Direction)} · {custody.Department} · signed off");
        return Result<CustodyEventDto>.Ok(ToDto(custody));
    }

}
