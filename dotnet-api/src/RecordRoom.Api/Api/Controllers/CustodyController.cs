using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Application.Services;
using RecordRoom.Api.Infrastructure.Auth;

namespace RecordRoom.Api.Api.Controllers;

/// <summary>
/// The digitization custody chain (§3.8): intake register and return sign-off.
/// Reads are open to any authenticated user; writes are supervisor work, the
/// same gate as scan review.
/// </summary>
[ApiController]
[Route("api/custody")]
[Authorize]
[RequirePermission("custody.view")]
[Produces("application/json")]
[Tags("Digitization")]
public class CustodyController(ICustodyService custody) : ControllerBase
{
    /// <summary>The custody register, newest first.</summary>
    [HttpGet]
    public async Task<IResult> List(
        [FromQuery] string? direction,
        [FromQuery] string? search,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken ct = default) =>
        Results.Ok(ApiResponse<PagedResult<CustodyEventDto>>.Ok(
            await custody.ListAsync(new CustodyQuery(direction, search, page, pageSize), ct)));

    /// <summary>Records an intake ("Intake") or a return ("Return") handover.</summary>
    [RequirePermission("custody.manage")]
    [HttpPost]
    public async Task<IResult> Record(CustodyRecordInput input, CancellationToken ct) =>
        ApiResults.FromResult(await custody.RecordAsync(input, ct));

    /// <summary>Sets the counted file total on an intake (the reconciliation step).</summary>
    [RequirePermission("custody.manage")]
    [HttpPost("{id:long}/reconcile")]
    public async Task<IResult> Reconcile(long id, CustodyReconcileInput input, CancellationToken ct) =>
        ApiResults.FromResult(await custody.ReconcileAsync(id, input, ct));

    /// <summary>Closes an event with a sign-off; closed events become read-only.</summary>
    [RequirePermission("custody.manage")]
    [HttpPost("{id:long}/sign-off")]
    public async Task<IResult> SignOff(long id, CustodySignOffInput input, CancellationToken ct) =>
        ApiResults.FromResult(await custody.SignOffAsync(id, input, ct));
}
