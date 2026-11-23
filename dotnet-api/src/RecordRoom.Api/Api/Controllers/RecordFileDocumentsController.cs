using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Application.Services;
using RecordRoom.Api.Infrastructure.Auth;

namespace RecordRoom.Api.Api.Controllers;

[ApiController]
[Route("api/files/{fileId:int}/documents")]
[Authorize]
[Produces("application/json")]
[Tags("Record file documents")]
public sealed class RecordFileDocumentsController(IRecordFileDocumentsService documents) : ControllerBase
{
    [HttpGet]
    public async Task<IResult> List(int fileId, CancellationToken ct)
    {
        var rows = await documents.ListAsync(fileId, ct);
        return rows is null ? Results.NotFound() : Results.Ok(ApiResponse<RecordFileDocumentDto[]>.Ok(rows));
    }

    [Authorize(Policy = "perm:digitization.upload")]
    [HttpPost]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(50331648)]
    [RequestFormLimits(MultipartBodyLengthLimit = 50331648)]
    public async Task<IResult> Upload(int fileId, [FromForm] IFormFile? document, CancellationToken ct,
        [FromQuery] bool importToStudio = false) =>
        ApiResults.FromResult(await documents.UploadAsync(fileId, document, ct, importToStudio));

    [HttpGet("{documentId:long}/content")]
    public async Task<IActionResult> Content(int fileId, long documentId, [FromQuery] bool download = false, CancellationToken ct = default)
    {
        var item = await documents.OpenAsync(fileId, documentId, ct);
        if (item is null) return NotFound();
        Response.Headers["Cache-Control"] = "private, no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        var disposition = new ContentDispositionHeaderValue(download ? "attachment" : "inline") { FileNameStar = item.FileName };
        Response.Headers["Content-Disposition"] = disposition.ToString();
        return File(item.Stream, item.ContentType, enableRangeProcessing: true);
    }

    /// <summary>
    /// Removing a stored scan version is destructive and gated by files.edit:
    /// Admin and Supervisor (who hold that cell) can delete, Operator and
    /// Employee cannot.
    /// </summary>
    [Authorize(Policy = "perm:files.edit")]
    [HttpDelete("{documentId:long}")]
    public async Task<IResult> Delete(int fileId, long documentId, CancellationToken ct) =>
        ApiResults.FromResult(await documents.DeleteAsync(fileId, documentId, ct));

    [HttpGet("{documentId:long}/ocr")]
    public async Task<IResult> Ocr(int fileId, long documentId, CancellationToken ct)
    {
        var map = await documents.GetOcrAsync(fileId, documentId, ct);
        return map is null ? Results.NotFound() : Results.Ok(ApiResponse<Dictionary<int, string>>.Ok(map));
    }

    [Authorize(Policy = "perm:digitization.upload")]
    [HttpPost("{documentId:long}/ocr")]
    public async Task<IResult> QueueOcr(int fileId, long documentId, CancellationToken ct) =>
        ApiResults.FromResult(await documents.QueueOcrAsync(fileId, documentId, ct));

    [Authorize(Policy = "perm:digitization.upload")]
    [HttpPut("{documentId:long}/ocr/{pageNo:int}")]
    public async Task<IResult> SaveOcrPage(int fileId, long documentId, int pageNo, [FromBody] DocumentOcrUpdateInput input, CancellationToken ct) =>
        ApiResults.FromResult(await documents.SaveOcrPageAsync(fileId, documentId, pageNo, input.Text ?? "", ct));
}

public sealed record DocumentOcrUpdateInput(string? Text);
