using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Infrastructure.Features;

namespace RecordRoom.Api.Api.Controllers;

/// <summary>
/// Public, read-only product settings. Anonymous on purpose: the login screen needs
/// to know the product name and which features exist before anyone has signed in.
/// Nothing secret belongs here.
/// </summary>
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
        Results.Ok(new AppConfigDto(AppInfo.Name, new FeaturesDto(flags.BarcodeEnabled)));
}
