using System.Data;
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
    Task<Result<CustodyEventDto>> RecordReturnAsync(long intakeId, CustodyReturnInput input, CancellationToken ct = default);
}

public sealed class CustodyService(
    AppDbContext db,
    IAuditWriter audit,
    ICurrentUserAccessor current) : ICustodyService
{
    private const int MaxPageSize = 100;

    private static CustodyEventDto ToDto(CustodyEvent e, int returnedCount = 0) => new(
        e.Id, Display.Custody(e.Direction), e.BatchRef, e.Department, e.Vendor,
        e.FileCount, e.ReconciledCount, e.RecordedBy, e.RecordedAt,
        e.SignedOffBy, e.SignedOffAt, e.Remarks, e.ParentEventId,
        e.ReconciledBy, e.ReconciledAt, returnedCount,
        e.Direction == CustodyDirection.In && e.ReconciledCount is int total
            ? Math.Max(0, total - returnedCount)
            : 0);

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

        var returnedByIntake = await db.CustodyEvents.AsNoTracking()
            .Where(item => item.ParentEventId != null)
            .GroupBy(item => item.ParentEventId!.Value)
            .Select(group => new { IntakeId = group.Key, Count = group.Sum(item => item.FileCount) })
            .ToDictionaryAsync(item => item.IntakeId, item => item.Count, ct);

        // The register is small, so collectionTotal is the true filtered size.
        return new PagedResult<CustodyEventDto>(
            items.Select(item => ToDto(item, returnedByIntake.GetValueOrDefault(item.Id))).ToArray(),
            total, page, pageSize, total);
    }

    public async Task<Result<CustodyEventDto>> RecordAsync(CustodyRecordInput input, CancellationToken ct = default)
    {
        var department = input.Department.Trim();
        if (department.Length == 0)
            return Result<CustodyEventDto>.Fail("Department is required.", "department");
        if (Display.ParseCustody(input.Direction) is { } requestedDirection
            && requestedDirection == CustodyDirection.In
            && !await db.Departments.AnyAsync(item => item.Active && item.Name == department, ct))
            return Result<CustodyEventDto>.Fail("Choose an active department from the department directory.", "department");

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
        custody.ReconciledBy = current.User?.DisplayName ?? current.UserName;
        custody.ReconciledAt = DateTime.UtcNow;
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

    public async Task<Result<CustodyEventDto>> RecordReturnAsync(
        long intakeId, CustodyReturnInput input, CancellationToken ct = default)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var intake = await db.CustodyEvents.FirstOrDefaultAsync(item => item.Id == intakeId, ct);
        if (intake is null) return Result<CustodyEventDto>.Fail("Intake event not found.");
        if (intake.Direction != CustodyDirection.In)
            return Result<CustodyEventDto>.Fail("Returns can only be recorded against an intake event.", "intakeId");
        if (intake.SignedOffAt is null || intake.ReconciledCount is null)
            return Result<CustodyEventDto>.Fail("Count and sign off the intake before recording its return.", "intakeId");
        if (input.FileCount < 1)
            return Result<CustodyEventDto>.Fail("Return count must be at least 1.", "fileCount");

        var returnedSoFar = await db.CustodyEvents
            .Where(item => item.ParentEventId == intakeId)
            .SumAsync(item => (int?)item.FileCount, ct) ?? 0;
        var remaining = intake.ReconciledCount.Value - returnedSoFar;
        if (input.FileCount > remaining)
            return Result<CustodyEventDto>.Fail(
                $"Only {remaining} of {intake.ReconciledCount} file(s) remain to be returned for this batch.",
                "fileCount");

        var actor = current.User?.DisplayName ?? current.UserName;
        var now = DateTime.UtcNow;
        var returned = new CustodyEvent
        {
            Direction = CustodyDirection.Out,
            ParentEventId = intake.Id,
            BatchRef = intake.BatchRef,
            Department = intake.Department,
            Vendor = intake.Vendor,
            FileCount = input.FileCount,
            ReconciledCount = input.FileCount,
            ReconciledBy = actor,
            ReconciledAt = now,
            RecordedBy = actor,
            RecordedAt = now,
            SignedOffBy = string.IsNullOrWhiteSpace(input.SignedOffBy) ? actor : input.SignedOffBy.Trim(),
            SignedOffAt = now,
            Remarks = input.Remarks.Trim(),
        };
        db.CustodyEvents.Add(returned);
        await audit.LogAsync(db, AuditAction.Create, "CustodyEvent", "pending", "-",
            $"Return · {intake.BatchRef} · {input.FileCount} file(s)",
            $"{actor} recorded return of {input.FileCount} file(s) for intake {intake.Id} ({intake.BatchRef}); signed off by {returned.SignedOffBy}.",
            ct);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        await audit.AnnounceAsync(RealtimeChannels.Digitization, "custody.return-recorded",
            returned.Id.ToString(), $"Return · {intake.BatchRef} · {input.FileCount} file(s)");
        return Result<CustodyEventDto>.Ok(ToDto(returned));
    }

    public async Task<Result<CustodyEventDto>> SignOffAsync(long id, CustodySignOffInput input, CancellationToken ct = default)
    {
        var custody = await db.CustodyEvents.FirstOrDefaultAsync(e => e.Id == id, ct);
        if (custody is null) return Result<CustodyEventDto>.Fail("Custody event not found.");

        if (custody.SignedOffAt is not null)
            return Result<CustodyEventDto>.Fail("This event is already signed off.");

        if (custody.Direction == CustodyDirection.In && custody.ReconciledCount is null)
            return Result<CustodyEventDto>.Fail("An intake must be counted and reconciled before sign-off.", "reconciledCount");

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
