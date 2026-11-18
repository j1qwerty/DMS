using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace RecordRoom.Api.Infrastructure.Features;

/// <summary>
/// Optional features retained in the codebase but not exposed in the current
/// Zila Panchayat delivery. Core proposal workflows must not depend on these.
/// </summary>
public enum OptionalProductFeature
{
    Movement,
    Support,
    BulkImport,
}

public interface IFeatureFlags
{
    bool BarcodeEnabled { get; }
    bool MovementEnabled { get; }
    bool SupportEnabled { get; }
    bool BulkImportEnabled { get; }
}

public sealed class FeatureFlags(IConfiguration configuration) : IFeatureFlags
{
    public const string BarcodeKey = "Features:BarcodeEnabled";
    public const string MovementKey = "Features:MovementEnabled";
    public const string SupportKey = "Features:SupportEnabled";
    public const string BulkImportKey = "Features:BulkImportEnabled";

    // Barcode, standalone movement history, support/inquiries and bulk import
    // are retained but hidden by default because they are not in the approved SoW.
    public bool BarcodeEnabled => Parse(configuration[BarcodeKey], fallback: false);
    public bool MovementEnabled => Parse(configuration[MovementKey], fallback: false);
    public bool SupportEnabled => Parse(configuration[SupportKey], fallback: false);
    public bool BulkImportEnabled => Parse(configuration[BulkImportKey], fallback: false);

    private static readonly string[] OffValues = ["false", "0", "off", "no", "disabled"];

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

/// <summary>Returns 404 when a retained optional feature is disabled.</summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class RequireOptionalFeatureAttribute(OptionalProductFeature feature) : ActionFilterAttribute
{
    public override void OnActionExecuting(ActionExecutingContext context)
    {
        var flags = context.HttpContext.RequestServices.GetService<IFeatureFlags>();
        if (flags is null) return;

        var enabled = feature switch
        {
            OptionalProductFeature.Movement => flags.MovementEnabled,
            OptionalProductFeature.Support => flags.SupportEnabled,
            OptionalProductFeature.BulkImport => flags.BulkImportEnabled,
            _ => false,
        };
        if (enabled) return;

        context.Result = new ObjectResult(
            Application.ApiResponse<bool>.Fail([
                new Application.FieldError($"The optional {feature} feature is not enabled.")
            ]))
        {
            StatusCode = StatusCodes.Status404NotFound,
        };
    }
}

/// <summary>
/// Blocks barcode actions with 404 while barcode features are switched off.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class RequireBarcodeFeatureAttribute : ActionFilterAttribute
{
    public const string OffMessage = "Barcode features are turned off.";

    public override void OnActionExecuting(ActionExecutingContext context)
    {
        var flags = context.HttpContext.RequestServices.GetService<IFeatureFlags>();
        if (flags is null || flags.BarcodeEnabled) return;

        context.Result = new ObjectResult(
            Application.ApiResponse<bool>.Fail([new Application.FieldError(OffMessage)]))
        {
            StatusCode = StatusCodes.Status404NotFound,
        };
    }
}
