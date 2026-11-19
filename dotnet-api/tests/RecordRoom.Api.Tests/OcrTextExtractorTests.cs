using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using RecordRoom.Api.Infrastructure.Ocr;

namespace RecordRoom.Api.Tests;

/// <summary>
/// The OCR orchestration behind the round-3 Hindi pipeline: images go straight
/// to the engine, PDFs are rasterized page by page, and a missing or failing
/// engine never breaks an upload — it reports "none". The engine itself is a
/// fake; the real tesseract pass is verified end-to-end against the sandbox
/// binary and by the harness on a deployment.
/// </summary>
public sealed class OcrTextExtractorTests
{
    private sealed class FakeEngine(bool available, params string[] results) : IOcrEngine
    {
        public int Calls { get; private set; }
        public bool IsAvailable { get; } = available;
        public string Languages { get; } = "hin+eng";

        public Task<string?> RunAsync(byte[] imageBytes, CancellationToken ct = default)
        {
            var result = Calls < results.Length ? results[Calls] : null;
            Calls++;
            return Task.FromResult(string.IsNullOrWhiteSpace(result) || result.Length < 4 ? null : result);
        }
    }

    private static OcrTextExtractor Extractor(IOcrEngine engine) =>
        new(engine, new ConfigurationBuilder().Build(), NullLogger<OcrTextExtractor>.Instance);

    private static byte[] TinyPng() =>
        Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");

    /// <summary>A real one-page PDF, the way QuestPDF writes the deliverables.</summary>
    private static byte[] OnePagePdf()
    {
        QuestPDF.Settings.License = LicenseType.Community;
        return Document
            .Create(container =>
            {
                container.Page(page =>
                {
                    page.Size(PageSizes.A5);
                    page.Content().Text("Page one");
                });
            })
            .GeneratePdf();
    }

    [Fact]
    public async Task An_image_goes_straight_to_the_engine()
    {
        var engine = new FakeEngine(true, "नमस्ते office");
        var extraction = await Extractor(engine).ExtractAsync(TinyPng(), "image/png");
        Assert.True(extraction.Found);
        Assert.Equal("नमस्ते office", extraction.Text);
        Assert.Equal("tesseract hin+eng", extraction.Method);
        Assert.Equal(1, engine.Calls);
    }

    [Fact]
    public async Task A_pdf_is_rasterized_and_read_page_by_page()
    {
        var engine = new FakeEngine(true, "page one text");
        var extraction = await Extractor(engine).ExtractAsync(OnePagePdf(), "application/pdf");
        Assert.True(extraction.Found);
        Assert.Equal("page one text", extraction.Text);
        Assert.Equal(1, engine.Calls);
    }

    [Fact]
    public async Task A_unreadable_pdf_reports_none_without_calling_the_engine()
    {
        var engine = new FakeEngine(true, "never");
        var extraction = await Extractor(engine).ExtractAsync("not a pdf"u8.ToArray(), "application/pdf");
        Assert.False(extraction.Found);
        Assert.Equal("none", extraction.Method);
        Assert.Equal(0, engine.Calls);
    }

    [Fact]
    public async Task A_missing_engine_reports_none()
    {
        var engine = new FakeEngine(false, "never");
        var extraction = await Extractor(engine).ExtractAsync(TinyPng(), "image/png");
        Assert.False(extraction.Found);
        Assert.Equal("none", extraction.Method);
        Assert.Equal(0, engine.Calls);
    }

    [Fact]
    public async Task An_unrecognized_content_type_reports_none()
    {
        var engine = new FakeEngine(true, "never");
        var extraction = await Extractor(engine).ExtractAsync(TinyPng(), "application/zip");
        Assert.False(extraction.Found);
        Assert.Equal(0, engine.Calls);
    }

    [Fact]
    public async Task A_multi_page_pdf_joins_each_page_text()
    {
        QuestPDF.Settings.License = LicenseType.Community;
        var pdf = Document
            .Create(container =>
            {
                container.Page(page =>
                {
                    page.Size(PageSizes.A5);
                    page.Content().Text("Page one");
                });
                container.Page(page =>
                {
                    page.Size(PageSizes.A5);
                    page.Content().Text("Page two");
                });
            })
            .GeneratePdf();

        var engine = new FakeEngine(true, "first page", "second page");
        var extraction = await Extractor(engine).ExtractAsync(pdf, "application/pdf");
        Assert.Equal("first page\n\nsecond page", extraction.Text);
        Assert.Equal(2, engine.Calls);
    }
}
