using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Application.Services;
using RecordRoom.Api.Infrastructure.Features;
using RecordRoom.Api.Infrastructure.Auth;

namespace RecordRoom.Api.Api.Controllers;

[ApiController]
[Route("api/digitization")]
[Authorize]
[RequirePermission("digitization.view")]
[Produces("application/json")]
[Tags("Digitization")]
public class DigitizationController(IFileScansService scans) : ControllerBase
{
    /// <summary>How many scan pages are waiting for review (dashboard badge).</summary>
    [HttpGet("pending-review-count")]
    public async Task<IResult> Pending(CancellationToken ct) =>
        Results.Ok(ApiResponse<int>.Ok(await scans.PendingReviewCountAsync(ct)));

    /// <summary>The pending-review queue across files — the Digitization section itself.</summary>
    [HttpGet("pending")]
    public async Task<IResult> Queue([FromQuery] string? search, CancellationToken ct) =>
        Results.Ok(ApiResponse<FileScanPageDto[]>.Ok(await scans.PendingAsync(search, ct)));
}

[ApiController]
[Route("api/files/{fileId:int}/scans")]
[Authorize]
[RequirePermission("digitization.view")]
[Produces("application/json")]
[Tags("Files")]
public class FileScansController(IFileScansService scans) : ControllerBase
{
    [HttpGet]
    public async Task<IResult> List(int fileId, CancellationToken ct) =>
        Results.Ok(ApiResponse<FileScanPageDto[]>.Ok(await scans.ListByFileAsync(fileId, ct)));

    [RequirePermission("digitization.upload")]
    [HttpPost]
    public async Task<IResult> Add(int fileId, ScanAddInput input, CancellationToken ct) =>
        ApiResults.FromResult(await scans.AddAsync(fileId, input, ct));

    [RequirePermission("digitization.review")]
    [HttpPost("review-all")]
    public async Task<IResult> ReviewAll(int fileId, PageReviewInput input, CancellationToken ct) =>
        ApiResults.FromResult(await scans.ReviewAllAsync(fileId, input, ct));
}

[ApiController]
[Route("api/scans")]
[Authorize]
[Produces("application/json")]
[Tags("Digitization")]
public class ScansController(IFileScansService scans) : ControllerBase
{
    [RequirePermission("digitization.upload")]
    [HttpPost("{scanId:long}/document")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(50331648)]
    [RequestFormLimits(MultipartBodyLengthLimit = 50331648)]
    public async Task<IResult> UploadDocument(long scanId, [FromForm] IFormFile? document, CancellationToken ct) =>
        ApiResults.FromResult(await scans.AddDocumentAsync(scanId, document, ct));

    /// <summary>Returns OCR text and provenance for an uploaded scan page.</summary>
    [RequirePermission("digitization.view")]
    [HttpGet("{scanId:long}/ocr")]
    public async Task<IResult> Ocr(long scanId, CancellationToken ct)
    {
        var result = await scans.GetOcrAsync(scanId, ct);
        return result is null
            ? Results.NotFound(ApiResponse<ScanOcrDto>.Fail([new FieldError("Scan page not found.")]))
            : Results.Ok(ApiResponse<ScanOcrDto>.Ok(result));
    }

    /// <summary>Stores a completed/failed OCR result from an approved extraction worker or verified import.</summary>
    [RequirePermission("digitization.upload")]
    [HttpPut("{scanId:long}/ocr")]
    public async Task<IResult> UpdateOcr(long scanId, ScanOcrInput input, CancellationToken ct) =>
        ApiResults.FromResult(await scans.UpdateOcrAsync(scanId, input, ct));

    [RequirePermission("digitization.view")]
    [HttpGet("{scanId:long}/content")]
    public async Task<IActionResult> Content(long scanId, [FromQuery] bool download = false, CancellationToken ct = default)
    {
        var item = await scans.OpenDocumentAsync(scanId, ct);
        if (item is null) return NotFound();
        Response.Headers["Cache-Control"] = "private, no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers["Content-Disposition"] = DocumentHttpHeaders.BuildDisposition(item.FileName, download);
        return File(item.Stream, item.ContentType, enableRangeProcessing: true);
    }

    [RequirePermission("digitization.review")]
    [HttpDelete("{scanId:long}")]
    public async Task<IResult> Remove(long scanId, CancellationToken ct) =>
        ApiResults.FromResult(await scans.RemoveAsync(scanId, ct));

    [RequirePermission("digitization.review")]
    [HttpPost("{scanId:long}/review")]
    public async Task<IResult> Review(long scanId, PageReviewInput input, CancellationToken ct) =>
        ApiResults.FromResult(await scans.ReviewAsync(scanId, input, ct));
}

internal static class DocumentHttpHeaders
{
    public static string BuildDisposition(string fileName, bool download)
    {
        var disposition = new Microsoft.Net.Http.Headers.ContentDispositionHeaderValue(download ? "attachment" : "inline")
        {
            FileNameStar = fileName
        };
        return disposition.ToString();
    }
}

[ApiController]
[Route("api/uploads")]
[Authorize]
[RequirePermission("files.view")]
[Produces("application/json")]
[Tags("Uploads")]
public class UploadsController(IUploadsService uploads) : ControllerBase
{
    [HttpGet("maps")]
    public async Task<IResult> Maps(
        [FromQuery] string? fileBarcode, [FromQuery] string? search, CancellationToken ct) =>
        Results.Ok(ApiResponse<MapUploadDto[]>.Ok(await uploads.MapsAsync(fileBarcode, search, ct)));

    [RequirePermission("digitization.upload")]
    [HttpPost("maps")]
    public async Task<IResult> AddMap(MapUploadInput input, CancellationToken ct) =>
        ApiResults.FromResult(await uploads.AddMapAsync(input, ct));

    [RequirePermission("digitization.upload")]
    [HttpPost("maps/{id:long}/document")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(50331648)]
    [RequestFormLimits(MultipartBodyLengthLimit = 50331648)]
    public async Task<IResult> UploadMapDocument(long id, [FromForm] IFormFile? document, CancellationToken ct) =>
        ApiResults.FromResult(await uploads.UploadMapDocumentAsync(id, document, ct));

    [RequirePermission("files.view")]
    [HttpGet("maps/{id:long}/content")]
    public async Task<IActionResult> MapContent(long id, [FromQuery] bool download = false, CancellationToken ct = default)
    {
        var item = await uploads.OpenMapDocumentAsync(id, ct);
        if (item is null) return NotFound();
        Response.Headers["Cache-Control"] = "private, no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers["Content-Disposition"] = DocumentHttpHeaders.BuildDisposition(item.FileName, download);
        return File(item.Stream, item.ContentType, enableRangeProcessing: true);
    }

    [RequirePermission("digitization.review")]
    [HttpDelete("maps/{id:long}")]
    public async Task<IResult> RemoveMap(long id, CancellationToken ct) =>
        ApiResults.FromResult(await uploads.RemoveMapAsync(id, ct));
}

[ApiController]
[Route("api/bulk")]
[RequireOptionalFeature(OptionalProductFeature.BulkImport)]
[Authorize]
[RequirePermission("files.bulkImport")]
[Produces("application/json")]
[Tags("Bulk")]
public class BulkController(IBulkService bulk) : ControllerBase
{
    [HttpGet("jobs")]
    public async Task<IResult> Jobs(CancellationToken ct) =>
        Results.Ok(ApiResponse<BulkJobDto[]>.Ok(await bulk.JobsAsync(ct)));

    [HttpGet("jobs/{id:long}")]
    public async Task<IResult> Job(long id, CancellationToken ct)
    {
        var job = await bulk.JobAsync(id, ct);
        return job is null ? Results.NotFound() : Results.Ok(ApiResponse<BulkJobDto>.Ok(job));
    }

    [HttpPost("validate")]
    public async Task<IResult> Validate(BulkValidateInput input, CancellationToken ct) =>
        ApiResults.FromResult(await bulk.ValidateAsync(input, ct));

    [HttpPost("jobs/{id:long}/commit")]
    public async Task<IResult> Commit(long id, CancellationToken ct) =>
        ApiResults.FromResult(await bulk.CommitAsync(id, ct));
}

[ApiController]
[Route("api/barcodes")]
[RequireBarcodeFeature]
[Authorize]
[RequirePermission("barcodes.print")]
[Produces("application/json")]
[Tags("Barcodes")]
public class BarcodesController(IBarcodeService barcodes) : ControllerBase
{
    [HttpGet("payload/{subject}/{targetId}")]
    public async Task<IResult> Payload(string subject, string targetId, CancellationToken ct)
    {
        if (!Enum.TryParse<Domain.BarcodeSubject>(subject, true, out var parsed))
            return Results.BadRequest(ApiResponse<object>.Fail([new FieldError("Unknown subject.", "subject")]));

        var payload = await barcodes.PayloadFor(parsed, targetId, ct);
        return payload is null
            ? Results.NotFound()
            : Results.Ok(ApiResponse<BarcodePayloadDto>.Ok(payload));
    }

    [HttpPost("validate")]
    public async Task<IResult> Validate(BarcodeValidateInput input, CancellationToken ct) =>
        Results.Ok(ApiResponse<BarcodeValidateResponse>.Ok(await barcodes.Validate(input, ct)));

    [HttpGet("qr")]
    public IResult Qr([FromQuery] string value) =>
        Results.Ok(ApiResponse<string>.Ok(barcodes.BuildQrUrl(value)));

    [HttpGet("jobs")]
    public async Task<IResult> Jobs(CancellationToken ct) =>
        Results.Ok(ApiResponse<BarcodeJobDto[]>.Ok(await barcodes.JobsAsync(ct)));

    [HttpPost("jobs")]
    public async Task<IResult> CreateJob(BarcodeJobInput input, CancellationToken ct) =>
        ApiResults.FromResult(await barcodes.CreateJobAsync(input, ct));

    [HttpDelete("jobs/{id:long}")]
    public async Task<IResult> CancelJob(long id, CancellationToken ct) =>
        ApiResults.FromResult(await barcodes.CancelJobAsync(id, ct));
}

[ApiController]
[Route("api/reports")]
[Authorize]
[RequirePermission("reports.view")]
[Produces("application/json")]
[Tags("Reports")]
public class ReportsController(IReportsService reports) : ControllerBase
{
    [HttpGet]
    public IResult Definitions() =>
        Results.Ok(ApiResponse<ReportDefinitionDto[]>.Ok(reports.Definitions()));

    [HttpGet("{key}")]
    public IResult Build(string key)
    {
        try
        {
            return Results.Ok(ApiResponse<ReportResultDto>.Ok(reports.Build(key)));
        }
        catch (ArgumentException ex)
        {
            return Results.BadRequest(ApiResponse<ReportResultDto>.Fail([new FieldError(ex.Message, "key")]));
        }
    }

    /// <summary>
    /// Streams the CSV. Large exports should move to a Hangfire job that writes
    /// to object storage; this path is fine for the row counts the UI shows now.
    /// </summary>
    [RequirePermission("reports.export")]
    [HttpGet("{key}/export")]
    public IResult Export(string key)
    {
        try
        {
            var csv = reports.BuildCsv(key, out var rows);
            var safe = key.Replace('/', '-');
            return Results.File(
                System.Text.Encoding.UTF8.GetBytes(csv),
                "text/csv; charset=utf-8",
                $"{safe}-{DateTime.UtcNow:yyyy-MM-dd}.csv");
        }
        catch (ArgumentException ex)
        {
            return Results.BadRequest(ApiResponse<object>.Fail([new FieldError(ex.Message, "key")]));
        }
    }
}
