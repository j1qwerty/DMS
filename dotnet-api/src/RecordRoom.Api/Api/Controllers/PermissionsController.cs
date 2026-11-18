using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Application.Services;
using RecordRoom.Api.Infrastructure.Auth;

namespace RecordRoom.Api.Api.Controllers;

/// <summary>
/// The editable capability matrix (work plan §3.7). Reads need
/// <c>users.view</c>; writes need <c>users.edit</c>. Single-cell PUTs so two
/// concurrent admins cannot clobber each other's matrix, with the Admin row
/// and the last <c>users.edit</c> holder locked server-side.
/// </summary>
[ApiController]
[Route("api/permissions")]
[Produces("application/json")]
[Tags("Permissions")]
public class PermissionsController(IPermissionService permissions) : ControllerBase
{
    [HttpGet("matrix")]
    [Authorize(Policy = "perm:users.view")]
    public async Task<IResult> Matrix(CancellationToken ct)
    {
        var matrix = await permissions.MatrixAsync(ct);
        return Results.Ok(ApiResponse<PermissionMatrixDto>.Ok(matrix));
    }

    [HttpPut("{role}/{permission}")]
    [Authorize(Policy = "perm:users.edit")]
    public async Task<IResult> Grant(
        string role, string permission, [FromBody] PermissionGrantInput input, CancellationToken ct)
    {
        var result = await permissions.GrantAsync(role, permission, input, ct);
        return ApiResults.FromResult(result);
    }
}
