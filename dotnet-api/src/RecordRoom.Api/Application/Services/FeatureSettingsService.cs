using Microsoft.EntityFrameworkCore;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Auth;
using RecordRoom.Api.Infrastructure.Data;
using RecordRoom.Api.Infrastructure.Features;

namespace RecordRoom.Api.Application.Services;

/// <summary>
/// The Admin-controlled feature switches (ZILA_PANCHAYAT_CC §F). Reads are the
/// live <c>FeatureSettings</c> rows plus the fallback defaults for keys with
/// no row yet; writes upsert one row per key, land in the audit trail, refresh
/// the in-process <see cref="IFeatureFlags"/> immediately and announce the new
/// state so other signed-in screens update without a reload.
/// </summary>
public interface IFeatureSettingsService
{
    Task<FeatureSettingDto[]> ListAsync(CancellationToken ct = default);
    Task<Result<FeatureSettingDto[]>> UpdateAsync(FeatureUpdateInput input, CancellationToken ct = default);
}

public sealed class FeatureSettingsService(
    AppDbContext db,
    IAuditWriter audit,
    ICurrentUserAccessor current,
    IFeatureFlags flags) : IFeatureSettingsService
{
    private static FeatureSettingDto ToDto(FeatureSetting s) =>
        new(s.FeatureKey, s.Enabled, s.UpdatedBy, s.UpdatedAt);

    public async Task<FeatureSettingDto[]> ListAsync(CancellationToken ct = default)
    {
        var rows = await db.FeatureSettings.AsNoTracking().ToDictionaryAsync(
            s => s.FeatureKey, s => s, StringComparer.OrdinalIgnoreCase, ct);

        // Every known group is reported, with the config fallback standing in
        // for keys that have never been written, so the Settings page always
        // shows the full matrix rather than only what has been toggled once.
        return FeatureFlags.KnownKeys
            .Select(key => rows.TryGetValue(key, out var row)
                ? ToDto(row)
                : new FeatureSettingDto(key, flags.IsEnabled(key), string.Empty, DateTime.MinValue))
            .ToArray();
    }

    public async Task<Result<FeatureSettingDto[]>> UpdateAsync(
        FeatureUpdateInput input, CancellationToken ct = default)
    {
        if (input.Features.Count == 0)
            return Result<FeatureSettingDto[]>.Fail("Name at least one feature to change.", "features");

        var unknown = input.Features.Keys
            .Where(key => !FeatureFlags.KnownKeys.Contains(key, StringComparer.OrdinalIgnoreCase))
            .ToArray();
        if (unknown.Length > 0)
            return Result<FeatureSettingDto[]>.Fail(
                $"Unknown feature group(s): {string.Join(", ", unknown)}.", "features");

        var rows = await db.FeatureSettings.ToDictionaryAsync(
            s => s.FeatureKey, s => s, StringComparer.OrdinalIgnoreCase, ct);

        var actor = current.User?.DisplayName ?? current.UserName;
        foreach (var (key, enabled) in input.Features)
        {
            var normalized = FeatureFlags.KnownKeys.First(
                k => string.Equals(k, key, StringComparison.OrdinalIgnoreCase));

            if (rows.TryGetValue(normalized, out var row))
            {
                if (row.Enabled == enabled) continue;
                row.Enabled = enabled;
                row.UpdatedBy = actor;
                row.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                row = new FeatureSetting
                {
                    FeatureKey = normalized,
                    Enabled = enabled,
                    UpdatedBy = actor,
                    UpdatedAt = DateTime.UtcNow,
                };
                rows[normalized] = row;
                db.FeatureSettings.Add(row);
            }

            await audit.LogAsync(
                db, AuditAction.Update, "FeatureSetting", normalized,
                (!enabled).ToString(), enabled.ToString(),
                $"{actor} turned the {normalized} feature group {(enabled ? "on" : "off")}.",
                ct);
        }

        await db.SaveChangesAsync(ct);

        // The singleton must reflect the row immediately: endpoint gating reads
        // it on every request, and a stale switch would serve a hidden group's
        // API for another process lifetime.
        flags.Apply(await db.FeatureSettings.AsNoTracking()
            .ToDictionaryAsync(s => s.FeatureKey, s => s.Enabled, StringComparer.OrdinalIgnoreCase, ct));

        await audit.AnnounceAsync(
            RealtimeChannels.Config, "features.updated", null,
            $"Feature groups updated by {actor}");
        return Result<FeatureSettingDto[]>.Ok(await ListAsync(ct));
    }
}
