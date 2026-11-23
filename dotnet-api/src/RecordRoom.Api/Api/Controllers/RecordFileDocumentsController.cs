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
    public async Task<IResult> Upload(int fileId, [FromForm] IFormFile? document, CancellationToken ct) =>
        ApiResults.FromResult(await documents.UploadAsync(fileId, document, ct));

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

    // ---------------------------------------------------------------------- OCR
    // The OCR text of a stored document version lives in SQL, one row per page.
    // Opening it never re-runs recognition: only the explicit re-run below does.

    /// <summary>Every page of one document version with its persisted OCR text.</summary>
    [HttpGet("{documentId:long}/pages")]
    public async Task<IResult> Pages(int fileId, long documentId, CancellationToken ct)
    {
        var rows = await documents.ListPagesAsync(fileId, documentId, ct);
        return rows is null
            ? Results.NotFound()
            : Results.Ok(ApiResponse<DocumentVersionPageDto[]>.Ok(rows));
    }

    /// <summary>How many pages carry text, and whether the background pass is still running.</summary>
    [HttpGet("{documentId:long}/ocr-status")]
    public async Task<IResult> OcrStatus(int fileId, long documentId, CancellationToken ct)
    {
        var status = await documents.OcrStatusAsync(fileId, documentId, ct);
        return status is null ? Results.NotFound() : Results.Ok(ApiResponse<DocumentOcrStatusDto>.Ok(status));
    }

    /// <summary>
    /// Re-runs recognition for one page of the stored document version and
    /// persists the result. The explicit, audited re-run — the reader itself
    /// always serves what is already stored.
    /// </summary>
    [Authorize(Policy = "perm:digitization.upload")]
    [HttpPost("{documentId:long}/pages/{pageNo:int}/ocr")]
    public async Task<IResult> RunPageOcr(int fileId, long documentId, int pageNo, CancellationToken ct) =>
        ApiResults.FromResult(await documents.RunPageOcrAsync(fileId, documentId, pageNo, ct));

    /// <summary>Saves a hand correction of one page's OCR text.</summary>
    [Authorize(Policy = "perm:digitization.upload")]
    [HttpPut("{documentId:long}/pages/{pageNo:int}/ocr/text")]
    public async Task<IResult> SavePageOcrText(
        int fileId, long documentId, int pageNo, OcrTextInput input, CancellationToken ct) =>
        ApiResults.FromResult(
            await documents.SavePageOcrTextAsync(fileId, documentId, pageNo, input?.Text ?? string.Empty, ct));
}
