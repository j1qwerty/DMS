using System.Collections.Concurrent;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace RecordRoom.Api.Infrastructure.Features;

/// <summary>
/// Optional product features, grouped so that flipping one switch shows or
/// hides every related surface — sidebar entry, sub-nav tabs, routes, registry
/// columns and the API endpoints behind them (which answer 404 while the
/// group is off, because from the client's point of view the capability does
/// not exist).
///
/// Groups (ZILA_PANCHAYAT_CC §F — the Zila Panchayat deployment keeps all
/// four off; nothing is removed, an Admin flips them back on at
/// <c>PUT /api/config/features</c>):
/// <list type="bullet">
/// <item><c>barcode</c> — barcode centre, scan validation, barcode ids and labels.</item>
/// <item><c>recordRoom</c> — rooms &amp; shelves, the location designer and shelf placement.</item>
/// <item><c>maps</c> — scanned maps and file copies.</item>
/// <item><c>support</c> — the help &amp; support page and its inquiry endpoints.</item>
/// </list>
///
/// Source of truth per key, first match wins: a <c>FeatureSettings</c> row
/// (the Admin's live choice), then <c>Features:{Key}Enabled</c> configuration,
/// then the deployment default (off for all four groups — the final Zila
/// Panchayat scope does not use them).
/// </summary>
public interface IFeatureFlags
{
    bool BarcodeEnabled { get; }
    bool RecordRoomEnabled { get; }
    bool MapsEnabled { get; }
    bool SupportEnabled { get; }

    /// <summary>Unknown keys read as off; the switch is the contract, not the caller.</summary>
    bool IsEnabled(string featureKey);

    /// <summary>Stable snapshot for <c>GET /api/config</c>.</summary>
    IReadOnlyDictionary<string, bool> Snapshot();

    /// <summary>Overlays live rows from the database (startup load and admin updates).</summary>
    void Apply(IReadOnlyDictionary<string, bool> overrides);
}

public sealed class FeatureFlags(IConfiguration configuration) : IFeatureFlags
{
    /// <summary>Every switchable group, in the order the Settings page lists them.</summary>
    public static readonly string[] KnownKeys = ["barcode", "recordRoom", "maps", "support"];

    private readonly ConcurrentDictionary<string, bool> overrides = new(StringComparer.OrdinalIgnoreCase);

    public bool BarcodeEnabled => IsEnabled("barcode");
    public bool RecordRoomEnabled => IsEnabled("recordRoom");
    public bool MapsEnabled => IsEnabled("maps");
    public bool SupportEnabled => IsEnabled("support");

    public bool IsEnabled(string featureKey) =>
        overrides.TryGetValue(featureKey, out var stored)
            ? stored
            : Parse(configuration[$"Features:{featureKey}Enabled"], fallback: false);

    public IReadOnlyDictionary<string, bool> Snapshot() =>
        KnownKeys.ToDictionary(key => key, IsEnabled);

    public void Apply(IReadOnlyDictionary<string, bool> values)
    {
        foreach (var (key, value) in values)
            overrides[key] = value;
    }

    private static readonly string[] OffValues = ["false", "0", "off", "no", "disabled"];

    /// <summary>
    /// Lenient on purpose. Configuration binding would crash startup on "off" or "0";
    /// an operator editing an env file should not be able to take the API down with
    /// a spelling choice. Blank or unrecognised text keeps the fallback.
    /// </summary>
    public static bool Parse(string? value, bool fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        var text = value.Trim();
        if (OffValues.Contains(text, StringComparer.OrdinalIgnoreCase)) return false;
        if (text.Equals("true", StringComparison.OrdinalIgnoreCase)
            || text == "1"
            || text.Equals("on", StringComparison.OrdinalIgnoreCase)
            || text.Equals("yes", StringComparison.OrdinalIgnoreCase)
            || text.Equals("enabled", StringComparison.OrdinalIgnoreCase))
            return true;
        return fallback;
    }
}

/// <summary>
/// Blocks an action with 404 while the feature group is switched off. 404 rather than
/// 403: from the client's point of view the capability does not exist.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public class RequireFeatureAttribute(string featureKey) : ActionFilterAttribute
{
    public const string OffMessage = "These features are turned off.";

    public override void OnActionExecuting(ActionExecutingContext context)
    {
        var flags = context.HttpContext.RequestServices.GetService<IFeatureFlags>();
        if (flags is null || flags.IsEnabled(featureKey)) return;

        context.Result = new ObjectResult(
            Application.ApiResponse<bool>.Fail([new Application.FieldError(OffMessage)]))
        {
            StatusCode = StatusCodes.Status404NotFound,
        };
    }
}

/// <summary>Backward-compatible spelling for the original barcode-only switch.</summary>
public sealed class RequireBarcodeFeatureAttribute : RequireFeatureAttribute
{
    public RequireBarcodeFeatureAttribute() : base("barcode") { }
}
