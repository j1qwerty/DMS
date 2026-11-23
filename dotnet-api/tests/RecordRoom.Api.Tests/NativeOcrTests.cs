using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using RecordRoom.Api.Infrastructure.Ocr;

namespace RecordRoom.Api.Tests;

public sealed class NativeOcrTests
{
    private static readonly string MixedImage = Path.Combine(AppContext.BaseDirectory, "Fixtures", "mixed-hindi-english.png");

    [TesseractFact]
    public async Task Tesseract_recognizes_mixed_Hindi_and_English()
    {
        var engine = new TesseractOcrEngine(Config(new()
        {
            ["Ocr:TesseractPath"] = Environment.GetEnvironmentVariable("RR_TEST_TESSERACT") ?? "tesseract",
            ["Ocr:Languages"] = "hin+eng"
        }), NullLogger<TesseractOcrEngine>.Instance);
        Assert.True(engine.Describe().Available, engine.Describe().Note);
        AssertMixed(await engine.RunAsync(await File.ReadAllBytesAsync(MixedImage)));
    }

    [PaddleFact]
    public async Task Paddle_recognizes_mixed_text_and_recovers_from_an_invalid_image()
    {
        using var engine = new PaddleOcrEngine(Config(new()
        {
            ["Ocr:Paddle:PythonPath"] = Environment.GetEnvironmentVariable("RR_TEST_PADDLE_PYTHON"),
            ["Ocr:Paddle:ModelDirectory"] = Environment.GetEnvironmentVariable("RR_TEST_PADDLE_MODELS")
        }), NullLogger<PaddleOcrEngine>.Instance);
        var image = await File.ReadAllBytesAsync(MixedImage);
        var first = await engine.RunAsync(image);
        AssertMixed(first);
        Assert.Equal(first, await engine.RunAsync(image));
        await Assert.ThrowsAsync<OcrEngineException>(() => engine.RunAsync("not an image"u8.ToArray()));
        Assert.False(engine.Describe().Available);
        Assert.Equal(first, await engine.RunAsync(image));
        Assert.True(engine.Describe().Available);
    }

    [Fact]
    public async Task Paddle_reports_an_unconfigured_worker_as_a_recoverable_engine_failure()
    {
        using var engine = new PaddleOcrEngine(Config(new()), NullLogger<PaddleOcrEngine>.Instance);
        Assert.False(engine.Describe().Available);
        await Assert.ThrowsAsync<OcrEngineException>(() => engine.RunAsync([1]));
    }

    private static IConfiguration Config(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    private static void AssertMixed(string? text)
    {
        Assert.NotNull(text);
        Assert.Contains("भारत", text);
        Assert.Contains("Audit Report", text, StringComparison.OrdinalIgnoreCase);
    }
}

public sealed class TesseractFactAttribute : FactAttribute
{
    public TesseractFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("RR_TEST_TESSERACT")))
            Skip = "Set RR_TEST_TESSERACT to exercise the installed Tesseract CLI.";
    }
}

public sealed class PaddleFactAttribute : FactAttribute
{
    public PaddleFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("RR_TEST_PADDLE_PYTHON")))
            Skip = "Set RR_TEST_PADDLE_PYTHON to exercise the real PP-OCRv5 models.";
    }
}
