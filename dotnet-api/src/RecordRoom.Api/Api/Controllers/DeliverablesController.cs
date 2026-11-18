using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Application.Services;
using RecordRoom.Api.Infrastructure.Auth;

namespace RecordRoom.Api.Api.Controllers;

/// <summary>
/// Generated PDF deliverables (§3.5, scope §1.2): the PDF built from a file's
/// approved scan pages, with header/footer, page numbers and — where OCR text
/// exists — an invisible text layer so the deliverable is searchable. The
/// derivative stays in the application as the reference copy while the PDF is
/// uploaded to e-office.
/// </summary>
[ApiController]
[Route("api/files/{fileId:int}/pdf")]
[Authorize]
[Produces("application/json")]
[Tags("Digitization")]
public class DeliverablesController(IScanStudioService studio) : ControllerBase
{
    [HttpGet]
    public async Task<IResult> List(int fileId, CancellationToken ct) =>
        Results.Ok(ApiResponse<DocumentDerivativeDto[]>.Ok(await studio.ListPdfsAsync(fileId, ct)));

    [Authorize(Policy = "perm:digitization.review")]
    [HttpPost]
    public async Task<IResult> Build(int fileId, DeliverablePdfInput input, CancellationToken ct) =>
        ApiResults.FromResult(await studio.BuildPdfAsync(fileId, input, ct));

    [HttpGet("{derivativeId:long}/content")]
    public async Task<IActionResult> Content(
        int fileId, long derivativeId, [FromQuery] bool download = true, CancellationToken ct = default)
    {
        var item = await studio.OpenPdfAsync(derivativeId, ct);
        if (item is null) return NotFound();
        Response.Headers["Cache-Control"] = "private, no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers["Content-Disposition"] = DocumentHttpHeaders.BuildDisposition(item.FileName, download);
        return File(item.Stream, item.ContentType, enableRangeProcessing: true);
    }
}
