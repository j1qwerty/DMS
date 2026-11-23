using RecordRoom.Api.Application.Services;

namespace RecordRoom.Api.Infrastructure.Ocr;

public static class OcrEngineNames
{
    public const string Tesseract = "tesseract";
    public const string Paddle = "paddleocr";
}

public interface IOcrEngineSelector
{
    Task<IOcrEngine> GetAsync(CancellationToken ct = default);
}

public sealed class OcrEngineSelector(
    IFeatureSettingsService settings, IOcrEngine tesseract, PaddleOcrEngine paddle) : IOcrEngineSelector
{
    public async Task<IOcrEngine> GetAsync(CancellationToken ct = default) =>
        await settings.GetOcrEngineAsync(ct) == OcrEngineNames.Paddle ? paddle : tesseract;
}

public sealed class OcrEngineException(string message, Exception? inner = null) : Exception(message, inner);
