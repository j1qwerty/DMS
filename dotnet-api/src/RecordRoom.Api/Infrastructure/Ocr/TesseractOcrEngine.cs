using System.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace RecordRoom.Api.Infrastructure.Ocr;

/// <summary>
/// One OCR pass over an image: the tesseract CLI behind a small interface so
/// the orchestration can be unit-tested without a binary. Tesseract is the
/// only mainstream engine with real Devanagari models, which is why the Hindi
/// scan path depends on it.
/// </summary>
public interface IOcrEngine
{
    /// <summary>True when the engine is configured and the binary was found.</summary>
    bool IsAvailable { get; }

    /// <summary>The language string passed to -l, e.g. "hin+eng".</summary>
    string Languages { get; }

    /// <summary>OCRs one image; null when the engine failed or found nothing.</summary>
    Task<string?> RunAsync(byte[] imageBytes, CancellationToken ct = default);
}

/// <summary>
/// Shells out to the tesseract CLI. A temp file in, text on stdout out — the
/// same command line on Windows and Linux, so a deployment only needs
/// "tesseract on PATH" (or an explicit path) plus the tessdata folder.
/// </summary>
public sealed class TesseractOcrEngine(
    IConfiguration configuration,
    ILogger<TesseractOcrEngine> logger) : IOcrEngine
{
    private const int MinMeaningfulLength = 4;

    private string BinaryPath => configuration.GetValue("Ocr:TesseractPath", "tesseract")!;
    public string Languages => configuration.GetValue("Ocr:Languages", "hin+eng")!;

    private string? TessDataDir
    {
        get
        {
            var configured = configuration.GetValue("Ocr:TessDataPath", "tessdata")!;
            // An absolute path is used as-is; a relative one resolves against
            // the content root, where the repo ships the folder.
            var path = Path.IsPathRooted(configured)
                ? configured
                : Path.Combine(Directory.GetCurrentDirectory(), configured);
            return Directory.Exists(path) ? path : null;
        }
    }

    public bool IsAvailable
    {
        get
        {
            try
            {
                var info = new ProcessStartInfo
                {
                    FileName = BinaryPath,
                    Arguments = "--version",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                using var process = Process.Start(info);
                if (process is null) return false;
                process.WaitForExit(5000);
                return process.ExitCode == 0 || !process.StandardError.EndOfStream;
            }
            catch (Exception ex)
            {
                logger.LogWarning(
                    "Tesseract is not reachable at '{Path}'; scanned pages will keep only their PDF text layer. ({Error})",
                    BinaryPath, ex.Message);
                return false;
            }
        }
    }

    public async Task<string?> RunAsync(byte[] imageBytes, CancellationToken ct = default)
    {
        if (imageBytes.Length == 0) return null;

        var tempDir = Path.Combine(Path.GetTempPath(), "rr-ocr-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        var inputPath = Path.Combine(tempDir, "page.png");

        try
        {
            await File.WriteAllBytesAsync(inputPath, imageBytes, ct);

            var arguments = new List<string>();
            var tessData = TessDataDir;
            if (tessData is not null) arguments.Add($"--tessdata-dir \"{tessData}\"");
            arguments.Add($"{inputPath} stdout -l {Languages} --psm 3");

            var info = new ProcessStartInfo
            {
                FileName = BinaryPath,
                Arguments = string.Join(' ', arguments),
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var process = new Process { StartInfo = info };
            process.Start();

            var timeout = TimeSpan.FromSeconds(configuration.GetValue("Ocr:TimeoutSeconds", 120));
            using var registration = ct.Register(() => { try { process.Kill(entireProcessTree: true); } catch { /* already gone */ } });

            var reading = process.StandardOutput.ReadToEndAsync(ct);
            // Drain stderr concurrently so a chatty engine never blocks on a full pipe.
            var draining = process.StandardError.ReadToEndAsync(ct);
            if (await Task.WhenAny(reading, Task.Delay(timeout, ct)) != reading)
            {
                try { process.Kill(entireProcessTree: true); } catch { /* already gone */ }
                logger.LogWarning("Tesseract timed out after {Seconds}s; giving up on this page.", timeout.TotalSeconds);
                return null;
            }

            await process.WaitForExitAsync(ct);
            var text = (await reading).Trim();

            // A page of smudges can still emit a stray character or two; that
            // is noise, not text.
            return text.Length >= MinMeaningfulLength ? text : null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Tesseract pass failed; the page keeps whatever text it already had.");
            return null;
        }
        finally
        {
            try { Directory.Delete(tempDir, true); } catch { /* best effort */ }
        }
    }
}
