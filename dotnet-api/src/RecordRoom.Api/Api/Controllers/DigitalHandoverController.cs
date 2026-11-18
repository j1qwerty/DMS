using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Application.Services;
using RecordRoom.Api.Infrastructure.Auth;

namespace RecordRoom.Api.Api.Controllers;

/// <summary>Prepare and record Department acceptance of checksum-backed digital deliverables.</summary>
[ApiController]
[Route("api/digital-handovers")]
[Authorize]
[RequirePermission("custody.view")]
[Produces("application/json")]
[Tags("Digital handover")]
public sealed class DigitalHandoverController(IDigitalHandoverService handovers) : ControllerBase
{
    [HttpGet]
    public async Task<IResult> List(CancellationToken ct) =>
        Results.Ok(ApiResponse<DigitalHandoverBatchDto[]>.Ok(await handovers.ListAsync(ct)));

    [HttpGet("{id:long}")]
    public async Task<IResult> Get(long id, CancellationToken ct)
    {
        var batch = await handovers.GetAsync(id, ct);
        return batch is null
            ? Results.NotFound(ApiResponse<bool>.Fail([new FieldError("Digital handover batch not found.")]))
            : Results.Ok(ApiResponse<DigitalHandoverBatchDto>.Ok(batch));
    }

    /// <summary>Snapshots the latest generated FinalPdf for every selected file into an immutable manifest.</summary>
    [RequirePermission("custody.manage")]
    [HttpPost]
    public async Task<IResult> Prepare(DigitalHandoverPrepareInput input, CancellationToken ct) =>
        ApiResults.FromResult(await handovers.PrepareAsync(input, ct));

    /// <summary>Marks the prepared package as delivered to the Department.</summary>
    [RequirePermission("custody.manage")]
    [HttpPost("{id:long}/deliver")]
    public async Task<IResult> Deliver(long id, CancellationToken ct) =>
        ApiResults.FromResult(await handovers.MarkDeliveredAsync(id, ct));

    /// <summary>Records the receiver's acceptance or rejection and the named representative.</summary>
    [RequirePermission("custody.manage")]
    [HttpPost("{id:long}/sign-off")]
    public async Task<IResult> SignOff(long id, DigitalHandoverSignOffInput input, CancellationToken ct) =>
        ApiResults.FromResult(await handovers.SignOffAsync(id, input, ct));

    /// <summary>Downloads the manifest, supporting metadata CSV and all final PDFs as one ZIP package.</summary>
    [RequirePermission("custody.manage")]
    [HttpGet("{id:long}/package")]
    public async Task<IActionResult> Download(long id, CancellationToken ct)
    {
        var result = await handovers.BuildPackageAsync(id, ct);
        if (!result.IsSuccess)
        {
            return new ObjectResult(ApiResponse<bool>.Fail(result.Errors))
            {
                StatusCode = StatusCodes.Status400BadRequest,
            };
        }

        var package = result.Value;
        Response.Headers["Cache-Control"] = "private, no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers["X-Package-SHA256"] = package.Sha256;
        Response.Headers[HeaderNames.ContentDisposition] =
            new ContentDispositionHeaderValue("attachment") { FileNameStar = package.FileName }.ToString();
        return File(package.Content, "application/zip", enableRangeProcessing: true);
    }
}
