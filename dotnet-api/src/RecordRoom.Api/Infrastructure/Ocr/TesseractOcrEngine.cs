using System.Collections.Concurrent;
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

    /// <summary>What the operator should see on the OCR screen: is the engine usable, and if not, why.</summary>
    OcrEngineStatus Describe();
}

/// <summary>
/// Engine health for the config endpoint: the UI shows exactly one actionable
/// line ("OCR unavailable - tesseract not installed") instead of pages that
/// silently carry no text.
/// </summary>
public sealed record OcrEngineStatus(
    bool BinaryFound,
    bool TessDataFound,
    string? TessDataPath,
    string[] MissingLanguages,
    string Note)
{
    public bool Available => BinaryFound && TessDataFound;
}

/// <summary>
/// Shells out to the tesseract CLI. A temp file in, text on stdout out — the
/// same command line on Windows and Linux, so a deployment only needs
/// "tesseract on PATH" (or an explicit path) plus the tessdata folder.
///
/// The tessdata folder ships with the repository and is copied into the
/// publish output (see the csproj), so the default lookup order — the
/// configured path, then the app folder, then the working directory — finds it
/// in every layout: `dotnet run`, a published bundle, or a Docker image.
/// </summary>
public sealed class TesseractOcrEngine(
    IConfiguration configuration,
    ILogger<TesseractOcrEngine> logger) : IOcrEngine
{
    private const int MinMeaningfulLength = 4;

    // Probing tesseract is a process spawn; the binary does not appear or
    // vanish during the process lifetime, so the answer is cached briefly to
    // keep /api/config and every upload off the spawn path.
    private static readonly ConcurrentDictionary<string, bool> AvailabilityCache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(60);
    private static readonly ConcurrentDictionary<string, DateTime> CacheStamps = new(StringComparer.OrdinalIgnoreCase);

    public string ResolvedBinaryPath
    {
        get
        {
            var configured = configuration.GetValue("Ocr:TesseractPath", "tesseract")!;
            if (File.Exists(configured)) return configured;

            if (!Path.IsPathRooted(configured))
            {
                // Check PATH entries
                var pathEnv = Environment.GetEnvironmentVariable("PATH");
                if (!string.IsNullOrWhiteSpace(pathEnv))
                {
                    var extensions = OperatingSystem.IsWindows() ? new[] { ".exe", "" } : new[] { "" };
                    foreach (var dir in pathEnv.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                    {
                        foreach (var ext in extensions)
                        {
                            try
                            {
                                var candidate = Path.Combine(dir, configured + ext);
                                if (File.Exists(candidate)) return candidate;
                            }
                            catch { /* ignore malformed path entries */ }
                        }
                    }
                }

                // Check standard installation paths
                if (OperatingSystem.IsWindows())
                {
                    var standardWindowsPaths = new[]
                    {
                        @"C:\Program Files\Tesseract-OCR\tesseract.exe",
                        @"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\Tesseract-OCR\tesseract.exe")
                    };
                    foreach (var candidate in standardWindowsPaths)
                    {
                        if (File.Exists(candidate)) return candidate;
                    }
                }
                else
                {
                    var standardUnixPaths = new[]
                    {
                        "/usr/bin/tesseract",
                        "/usr/local/bin/tesseract",
                        "/opt/homebrew/bin/tesseract"
                    };
                    foreach (var candidate in standardUnixPaths)
                    {
                        if (File.Exists(candidate)) return candidate;
                    }
                }
            }

            return configured;
        }
    }

    public string Languages => configuration.GetValue("Ocr:Languages", "hin+eng")!;

    private string[] RequestedLanguages =>
        Languages.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>
    /// Where the traineddata files live. The configured value wins when it
    /// resolves; a relative value is tried against the app folder first (the
    /// publish output carries the folder) and the current directory second
    /// (repo layouts). A directory only counts when it holds the language
    /// files the configuration actually asks for.
    /// </summary>
    private string? TessDataDir
    {
        get
        {
            var configured = configuration.GetValue("Ocr:TessDataPath", "tessdata")!;
            var requested = RequestedLanguages;

            foreach (var candidate in Candidates(configured))
            {
                if (Directory.Exists(candidate) && HasLanguages(candidate, requested))
                    return candidate;
            }

            // Second chance: a directory that exists but lacks the configured
            // languages is still better than nothing if it has any language at
            // all - but the status must be honest about the gap.
            foreach (var candidate in Candidates(configured))
            {
                if (Directory.Exists(candidate) && Directory.EnumerateFiles(candidate, "*.traineddata").Any())
                    return candidate;
            }

            return null;

            IEnumerable<string> Candidates(string configured)
            {
                if (Path.IsPathRooted(configured))
                {
                    yield return configured;
                    yield break;
                }
                yield return Path.Combine(AppContext.BaseDirectory, configured);
                yield return Path.Combine(Directory.GetCurrentDirectory(), configured);
                // `dotnet run` from the repo root: dotnet-api/tessdata.
                yield return Path.Combine(
                    Directory.GetCurrentDirectory(), "dotnet-api", configured);
                // `dotnet run` from src/RecordRoom.Api:
                yield return Path.Combine(
                    Directory.GetCurrentDirectory(), "..", "..", configured);
                yield return Path.Combine(
                    Directory.GetCurrentDirectory(), "..", configured);

                // If tesseract binary directory has tessdata:
                var bin = ResolvedBinaryPath;
                if (File.Exists(bin))
                {
                    var binDir = Path.GetDirectoryName(bin);
                    if (!string.IsNullOrEmpty(binDir))
                    {
                        yield return Path.Combine(binDir, configured);
                    }
                }

                // Well-known Linux system tessdata locations:
                if (!OperatingSystem.IsWindows())
                {
                    yield return "/usr/share/tesseract-ocr/5/tessdata";
                    yield return "/usr/share/tesseract-ocr/4.00/tessdata";
                    yield return "/usr/share/tessdata";
                }
            }

            static bool HasLanguages(string dir, string[] languages) =>
                languages.All(lang => File.Exists(Path.Combine(dir, $"{lang}.traineddata")));
        }
    }

    public bool IsAvailable
    {
        get
        {
            if (!configuration.GetValue("Ocr:Enabled", true))
                return false;

            var path = ResolvedBinaryPath;
            if (AvailabilityCache.TryGetValue(path, out var cached)
                && CacheStamps.TryGetValue(path, out var stamp)
                && DateTime.UtcNow - stamp < CacheTtl)
                return cached;

            var available = Probe();
            AvailabilityCache[path] = available;
            CacheStamps[path] = DateTime.UtcNow;
            return available;
        }
    }

    private bool Probe()
    {
        var path = ResolvedBinaryPath;
        try
        {
            var info = new ProcessStartInfo
            {
                FileName = path,
                Arguments = "--version",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var process = Process.Start(info);
            if (process is null) return false;

            // Tesseract prints its version banner to stderr; a plain
            // WaitForExit(timeout) that returns false leaves HasExited false,
            // and reading ExitCode on a live process throws — which the old
            // code swallowed as "unavailable".
            if (!process.WaitForExit(5000))
            {
                try { process.Kill(entireProcessTree: true); } catch { /* already gone */ }
                logger.LogWarning("Tesseract at '{Path}' did not answer --version within 5s.", path);
                return false;
            }
            return process.ExitCode == 0 || !process.StandardError.EndOfStream;
        }
        catch (Exception ex)
        {
            logger.LogWarning(
                "Tesseract is not reachable at '{Path}'; scanned pages will keep only their PDF text layer. ({Error})",
                path, ex.Message);
            return false;
        }
    }

    public OcrEngineStatus Describe()
    {
        var binaryFound = IsAvailable;
        var tessData = TessDataDir;
        var tessDataFound = tessData is not null
            && RequestedLanguages.All(lang => File.Exists(Path.Combine(tessData, $"{lang}.traineddata")));
        var missing = tessData is null
            ? RequestedLanguages
            : RequestedLanguages.Where(lang => !File.Exists(Path.Combine(tessData, $"{lang}.traineddata"))).ToArray();

        string note;
        if (binaryFound && tessDataFound)
            note = $"Tesseract ready ({string.Join("+", RequestedLanguages)}).";
        else if (!binaryFound)
            note = $"The tesseract binary was not found at '{ResolvedBinaryPath}'. Install tesseract (and the " +
                   $"{string.Join("/", RequestedLanguages)} language packs) or set Ocr__TesseractPath.";
        else if (tessData is null)
            note = $"No tessdata folder with the configured languages was found. Point Ocr__TessDataPath at a " +
                   $"folder containing {string.Join(", ", RequestedLanguages.Select(l => l + ".traineddata"))}.";
        else
            note = $"The tessdata folder at '{tessData}' is missing: {string.Join(", ", missing.Select(l => l + ".traineddata"))}. " +
                   "Install the missing language packs or adjust Ocr__Languages.";

        return new OcrEngineStatus(binaryFound, tessDataFound, tessData, missing, note);
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
            arguments.Add($"\"{inputPath}\" stdout -l {Languages} --psm 3");

            var info = new ProcessStartInfo
            {
                FileName = ResolvedBinaryPath,
                Arguments = string.Join(' ', arguments),
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = System.Text.Encoding.UTF8,
                StandardErrorEncoding = System.Text.Encoding.UTF8,
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
