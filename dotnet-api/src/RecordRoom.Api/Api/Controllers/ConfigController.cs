using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Application.Services;
using RecordRoom.Api.Infrastructure.Features;

namespace RecordRoom.Api.Api.Controllers;

/// <summary>
/// Product configuration. <c>GET</c> is public on purpose: the login screen
/// needs to know the product name and which features exist before anyone has
/// signed in. Nothing secret belongs here.
/// <c>PUT /api/config/features</c> is the Admin switchboard for the feature
/// groups (ZILA_PANCHAYAT_CC §F): hidden groups come back without a redeploy.
/// </summary>
[ApiController]
[Route("api/config")]
[Produces("application/json")]
[Tags("Config")]
public class ConfigController(IFeatureFlags flags, IFeatureSettingsService settings) : ControllerBase
{
    [HttpGet]
    [AllowAnonymous]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public IResult Get() =>
        Results.Ok(new AppConfigDto(AppInfo.Name, ToFeaturesDto(flags.Snapshot())));

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
    /// </summary>
    [HttpPut("features")]
    [Authorize(Policy = "perm:users.edit")]
    public async Task<IResult> UpdateFeatures([FromBody] FeatureUpdateInput input, CancellationToken ct)
    {
        var result = await settings.UpdateAsync(input, ct);
        return ApiResults.FromResult(result);
    }

    private static FeaturesDto ToFeaturesDto(IReadOnlyDictionary<string, bool> snapshot) => new(
        snapshot.GetValueOrDefault("barcode"),
        snapshot.GetValueOrDefault("recordRoom"),
        snapshot.GetValueOrDefault("maps"),
        snapshot.GetValueOrDefault("support"));
}
