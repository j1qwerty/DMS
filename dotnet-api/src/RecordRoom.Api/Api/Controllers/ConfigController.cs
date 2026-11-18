using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Infrastructure.Features;

namespace RecordRoom.Api.Api.Controllers;

/// <summary>Public, read-only product settings. No secrets belong here.</summary>
[ApiController]
[Route("api/config")]
[AllowAnonymous]
[Produces("application/json")]
[Tags("Config")]
public class ConfigController(IFeatureFlags flags) : ControllerBase
{
    [HttpGet]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public IResult Get() =>
        Results.Ok(new AppConfigDto(
            AppInfo.Name,
            new FeaturesDto(
                flags.BarcodeEnabled,
                flags.MovementEnabled,
                flags.SupportEnabled,
                flags.BulkImportEnabled)));
}
