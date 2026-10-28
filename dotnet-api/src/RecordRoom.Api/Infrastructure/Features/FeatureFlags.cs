using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace RecordRoom.Api.Infrastructure.Features;

/// <summary>
/// Optional product features.
///
/// The product is a Document Management System. The record room (physical file
/// tracking, rooms and shelves) is an additional section of it, and barcodes belong to
/// that section only. <see cref="BarcodeEnabled"/> turns the barcode part on or off; it
/// is ON by default. When off, files are identified by file number: the barcode
/// endpoints are blocked, new files and shelves get an internal id without asking for
/// one, and reports and permissions stop mentioning barcodes. The stored internal id
/// itself is kept, because maps, scans and history are linked through it.
///
/// Set it with <c>Features:BarcodeEnabled</c> in <c>appsettings.json</c> or the
/// environment variable <c>Features__BarcodeEnabled</c>. The frontend reads it from
/// <c>GET /api/config</c>, so it needs no rebuild.
/// </summary>
public interface IFeatureFlags
{
    bool BarcodeEnabled { get; }
}

public sealed class FeatureFlags(IConfiguration configuration) : IFeatureFlags
{
    public const string BarcodeKey = "Features:BarcodeEnabled";

    /// <summary>Read on every call so a changed setting is picked up without a restart.</summary>
    public bool BarcodeEnabled => Parse(configuration[BarcodeKey], fallback: true);

    private static readonly string[] OffValues = ["false", "0", "off", "no", "disabled"];

    /// <summary>
    /// Lenient on purpose. Configuration binding would crash startup on "off" or "0";
    /// an operator editing an env file should not be able to take the API down with
    /// a spelling choice. Blank or unrecognised text keeps the fallback (on).
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
/// Blocks an action with 404 while barcode features are switched off. 404 rather than
/// 403: from the client's point of view the capability does not exist.
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
