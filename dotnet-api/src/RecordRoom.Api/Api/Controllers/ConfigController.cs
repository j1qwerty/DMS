using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Application.Services;
using RecordRoom.Api.Infrastructure.Features;
using RecordRoom.Api.Infrastructure.Ocr;

namespace RecordRoom.Api.Api.Controllers;

/// <summary>
/// Product configuration. <c>GET</c> is public on purpose: the login screen
/// needs to know the product name and which features exist before anyone has
/// signed in. Nothing secret belongs here. It also reports whether the
/// deployment allows runtime feature edits (<c>Settings:AllowFeatureEditing</c>)
/// and whether the registry runs on the demo dataset (<c>App:DemoMode</c>) —
/// both come from the environment (.env / env vars), never from the database.
/// <c>PUT /api/config/features</c> is the Admin switchboard for the feature
/// groups (ZILA_PANCHAYAT_CC §F): hidden groups come back without a redeploy.
/// A deployment that locked the switchboard answers 403 here.
/// </summary>
[ApiController]
[Route("api/config")]
[Produces("application/json")]
[Tags("Config")]
public class ConfigController(
    IFeatureFlags flags,
    IFeatureSettingsService settings,
    IOcrEngine ocrEngine,
    IConfiguration configuration) : ControllerBase
{
    [HttpGet]
    [AllowAnonymous]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public IResult Get()
    {
        var status = ocrEngine.Describe();
        var ocrEnabled = configuration.GetValue("Ocr:Enabled", true);
        return Results.Ok(new AppConfigDto(
            AppInfo.Name,
            ToFeaturesDto(flags.Snapshot()),
            configuration.GetValue("Settings:AllowFeatureEditing", true),
            configuration.GetValue("App:DemoMode", true),
            new OcrStatusDto(
                ocrEnabled,
                ocrEnabled && status.Available,
                "tesseract",
                ocrEngine.Languages,
                !ocrEnabled
                    ? "OCR is switched off in this deployment (Ocr__Enabled=false)."
                    : status.Note)));
    }

    /// <summary>Every group with its live state — the Settings → Feature visibility source.</summary>
    [HttpGet("features")]
    [Authorize(Policy = "perm:users.view")]
    public async Task<IResult> Features(CancellationToken ct)
    {
        var rows = await settings.ListAsync(ct);
        return Results.Ok(ApiResponse<FeatureSettingDto[]>.Ok(rows));
    }

    /// <summary>
    /// Turns feature groups on or off. Audit-written; other screens hear the
    /// change on the <c>config</c> channel and re-read this configuration.
    /// Refused with 403 when the deployment locked the switchboard through
    /// <c>Settings:AllowFeatureEditing=false</c> — in production the .env file
    /// is the single source of truth.
    /// </summary>
    [HttpPut("features")]
    [Authorize(Policy = "perm:users.edit")]
    public async Task<IResult> UpdateFeatures([FromBody] FeatureUpdateInput input, CancellationToken ct)
    {
        if (!configuration.GetValue("Settings:AllowFeatureEditing", true))
        {
            return Results.Json(
                ApiResponse<bool>.Fail([
                    new FieldError(
                        "Feature visibility is locked by the server environment. " +
                        "Change Settings__AllowFeatureEditing in the deployment's .env file and restart the API.")]),
                statusCode: StatusCodes.Status403Forbidden);
        }

        var result = await settings.UpdateAsync(input, ct);
        return ApiResults.FromResult(result);
    }

    private static FeaturesDto ToFeaturesDto(IReadOnlyDictionary<string, bool> snapshot) => new(
        snapshot.GetValueOrDefault("barcode"),
        snapshot.GetValueOrDefault("recordRoom"),
        snapshot.GetValueOrDefault("maps"),
        snapshot.GetValueOrDefault("support"));
}
