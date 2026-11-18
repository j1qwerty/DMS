using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Application.Services;
using RecordRoom.Api.Infrastructure.Auth;

namespace RecordRoom.Api.Api.Controllers;

[ApiController]
[Route("api/files/{fileId:int}/digitization/final-pdf")]
[Authorize]
[RequirePermission("digitization.review")]
[Produces("application/json")]
[Tags("Digitization")]
public sealed class FinalPdfController(IScanPdfCompositionService composition) : ControllerBase
{
    /// <summary>
    /// Composes the latest approved scan version of each page side into an
    /// immutable, versioned final PDF. Original scans remain untouched.
    /// </summary>
    [HttpPost]
    public async Task<IResult> Generate(int fileId, CancellationToken ct) =>
        ApiResults.FromResult(await composition.GenerateFinalPdfAsync(fileId, ct));
}
