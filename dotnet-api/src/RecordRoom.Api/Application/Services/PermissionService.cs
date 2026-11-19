using Microsoft.EntityFrameworkCore;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Auth;
using RecordRoom.Api.Infrastructure.Cache;
using RecordRoom.Api.Infrastructure.Data;

namespace RecordRoom.Api.Application.Services;

/// <summary>
/// The editable capability matrix (work plan §3.7, design doc
/// `V2-EDITABLE-PERMISSIONS.md`). Grants are stored as present rows —
/// absence means not granted — and every authorized endpoint resolves through
/// <see cref="HasAsync"/>, so a revoked grant is enforced on the server, not
/// just hidden in the UI. The Admin row is fixed and the last
/// <c>users.edit</c> holder can never be revoked, so the matrix cannot lock
/// the deployment out of itself.
/// </summary>
public interface IPermissionService
{
    /// <summary> consulted on every authorized request; cached per role.</summary>
    Task<bool> HasAsync(string role, string permission, CancellationToken ct = default);

    /// <summary>Effective grants for a role (the seeded list until the table is populated).</summary>
    Task<string[]> ForRoleAsync(string role, CancellationToken ct = default);

    /// <summary>Effective grants intersected with feature visibility, for /auth/me.</summary>
    Task<string[]> VisibleForAsync(string role, CancellationToken ct = default);

    Task<PermissionMatrixDto> MatrixAsync(CancellationToken ct = default);

    /// <summary>Single-cell update. Admin is fixed; the last users.edit holder is protected.</summary>
    Task<Result<PermissionMatrixDto>> GrantAsync(
        string role, string permission, PermissionGrantInput input, CancellationToken ct = default);
}

public sealed class PermissionService(
    AppDbContext db,
    IAuditWriter audit,
    ICurrentUserAccessor current,
    ICacheService cache,
    Infrastructure.Features.IFeatureFlags flags) : IPermissionService
{
    /// <summary>
    /// The permission catalogue — same 21 keys as the frontend
    /// `services/permissions.ts` `PERMISSIONS`, in the same order so the
    /// matrix renders identically on both sides.
    /// </summary>
    public static readonly string[] Catalogue =
    [
        "files.view", "files.create", "files.edit", "files.bulkImport",
        "issue.issue", "issue.return",
        "locations.view", "locations.edit",
        "digitization.view", "digitization.upload", "digitization.review",
        "studio.use",
        "employees.view", "employees.edit",
        "users.view", "users.edit",
        "audit.view", "audit.fileViews",
        "reports.view", "reports.export",
        "barcodes.print",
    ];

    public static readonly string[] Roles = [Role.Admin.ToString(), "Supervisor", "Operator", "Employee"];

    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(30);

    private string CacheKey(string role) => $"perms:{role}";

    public async Task<bool> HasAsync(string role, string permission, CancellationToken ct = default)
    {
        var grants = await ForRoleAsync(role, ct);
        return grants.Contains(permission, StringComparer.Ordinal);
    }

    public Task<string[]> ForRoleAsync(string role, CancellationToken ct = default) =>
        cache.GetOrCreateAsync(CacheKey(role), CacheTtl, async () =>
        {
            var stored = await db.RolePermissions.AsNoTracking()
                .Where(p => p.Role == role)
                .Select(p => p.Permission)
                .ToListAsync(ct);

            // Before the first seed (or on a database the seeder has not reached
            // yet) the v1 static lists stand in, so a fresh deployment is never
            // locked out mid-startup.
            return stored.Count > 0
                ? Catalogue.Where(c => stored.Contains(c, StringComparer.Ordinal)).ToArray()
                : AuthService.PermissionsForRole(ParseRole(role));
        });

    public async Task<string[]> VisibleForAsync(string role, CancellationToken ct = default)
    {
        var grants = await ForRoleAsync(role, ct);
        // Permissions whose feature group is hidden are not offered: the
        // capability genuinely does not exist in this deployment.
        return grants
            .Where(p => !p.StartsWith("locations.", StringComparison.Ordinal) || flags.RecordRoomEnabled)
            .Where(p => p != "barcodes.print" || flags.BarcodeEnabled)
            .ToArray();
    }

    public async Task<PermissionMatrixDto> MatrixAsync(CancellationToken ct = default)
    {
        var rows = await db.RolePermissions.AsNoTracking().ToListAsync(ct);
        var storedByRole = rows.ToLookup(r => r.Role, StringComparer.OrdinalIgnoreCase);

        return new PermissionMatrixDto(
            Catalogue,
            Roles.Select(role =>
            {
                var stored = storedByRole[role].Select(r => r.Permission).ToHashSet(StringComparer.Ordinal);
                var effective = stored.Count > 0
                    ? Catalogue.Where(c => stored.Contains(c)).ToArray()
                    : AuthService.PermissionsForRole(ParseRole(role));
                return new PermissionMatrixRowDto(role, effective);
            }).ToArray());
    }

    public async Task<Result<PermissionMatrixDto>> GrantAsync(
        string role, string permission, PermissionGrantInput input, CancellationToken ct = default)
    {
        if (!Roles.Contains(role, StringComparer.OrdinalIgnoreCase))
            return Result<PermissionMatrixDto>.Fail(
                $"Role must be one of {string.Join(", ", Roles)}.", "role");

        if (!Catalogue.Contains(permission, StringComparer.Ordinal))
            return Result<PermissionMatrixDto>.Fail($"Unknown permission: {permission}.", "permission");

        var normalizedRole = Roles.First(r => string.Equals(r, role, StringComparison.OrdinalIgnoreCase));

        // The Admin role is the recovery path: if it could revoke its own
        // users.edit, the last administrator would strand every account and
        // the only remedy would be direct database access.
        if (normalizedRole == Role.Admin.ToString())
            return Result<PermissionMatrixDto>.Fail("The Admin role is fixed.", "role");

        if (!input.Granted && permission == "users.edit")
        {
            var holders = await db.RolePermissions.AsNoTracking()
                .Where(p => p.Permission == "users.edit")
                .Select(p => p.Role)
                .ToListAsync(ct);
            // Admin's fixed grants are not in the table, so count it as a holder.
            var distinct = holders.Select(h => NormalizeRoleName(h)).Append(Role.Admin.ToString())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            distinct.Remove(normalizedRole);
            if (distinct.Count == 0)
                return Result<PermissionMatrixDto>.Fail(
                    "At least one role must keep users.edit.", "permission");
        }

        var existing = await db.RolePermissions.FirstOrDefaultAsync(
            p => p.Role == normalizedRole && p.Permission == permission, ct);

        var actor = current.User?.DisplayName ?? current.UserName;
        if (input.Granted)
        {
            if (existing is null)
            {
                db.RolePermissions.Add(new RolePermission
                {
                    Role = normalizedRole,
                    Permission = permission,
                    GrantedBy = actor,
                    GrantedAt = DateTime.UtcNow,
                });
                await audit.LogAsync(db, AuditAction.Update, "RolePermission", $"{normalizedRole}:{permission}",
                    "not granted", "granted",
                    $"{actor} granted {permission} to {normalizedRole}.", ct);
            }
        }
        else if (existing is not null)
        {
            db.RolePermissions.Remove(existing);
            await audit.LogAsync(db, AuditAction.Delete, "RolePermission", $"{normalizedRole}:{permission}",
                "granted", "not granted",
                $"{actor} revoked {permission} from {normalizedRole}.", ct);
        }

        await db.SaveChangesAsync(ct);

        // One grant change invalidates exactly that role's cache entry; the
        // other three keep serving. The store is authoritative again in ≤30s
        // on any node that missed the removal.
        await cache.RemoveAsync(CacheKey(normalizedRole));
        await audit.AnnounceAsync(
            RealtimeChannels.Audit, "permissions.updated", $"{normalizedRole}:{permission}",
            $"{permission} {(input.Granted ? "granted to" : "revoked from")} {normalizedRole}");
        return Result<PermissionMatrixDto>.Ok(await MatrixAsync(ct));
    }

    private static Role ParseRole(string role) => Enum.TryParse<Role>(role, true, out var parsed) ? parsed : Role.Employee;

    private static string NormalizeRoleName(string role) => ParseRole(role).ToString();
}
