using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace RecordRoom.Api.Infrastructure.Ocr;

/// <summary>Owns one local CPU worker. Requests are serial so the models and memory are reused.</summary>
public sealed class PaddleOcrEngine(
    IConfiguration configuration, ILogger<PaddleOcrEngine> logger) : IOcrEngine, IDisposable
{
    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim gate = new(1, 1);
    private Process? worker;
    private volatile bool failed;

    public string Name => OcrEngineNames.Paddle;
    public string Languages => "hin+eng";

    private string? Python => configuration["Ocr:Paddle:PythonPath"];
    private string Script => configuration["Ocr:Paddle:WorkerPath"]
        ?? Path.Combine(AppContext.BaseDirectory, "ocr-worker", "paddle_worker.py");
    public bool IsAvailable => configuration.GetValue("Ocr:Enabled", true)
        && !string.IsNullOrWhiteSpace(Python) && File.Exists(Script);

    public OcrEngineStatus Describe()
    {
        var configured = IsAvailable;
        var note = !configured
            ? "Set Ocr__Paddle__PythonPath to the Python environment with PaddleOCR installed."
            : failed
                ? "The PaddleOCR worker failed its last request. Check the API logs and model installation."
                : "PaddleOCR CPU worker configured (PP-OCRv5 Mobile, Hindi and English).";
        return new(configured && !failed, configured, null, [], note);
    }

    public async Task<string?> RunAsync(byte[] imageBytes, CancellationToken ct = default)
    {
        if (imageBytes.Length == 0) return null;
        if (!IsAvailable) throw new OcrEngineException(Describe().Note);

        await gate.WaitAsync(ct);
        DirectoryInfo? temp = null;
        try
        {
            var process = await GetWorkerAsync(ct);
            temp = Directory.CreateTempSubdirectory("rr-paddle-");
            var imagePath = Path.Combine(temp.FullName, "page.img");
            await File.WriteAllBytesAsync(imagePath, imageBytes, ct);

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(
                configuration.GetValue("Ocr:Paddle:TimeoutSeconds", 120), 1, 600)));
            await process.StandardInput.WriteLineAsync(
                JsonSerializer.Serialize(imagePath).AsMemory(), timeout.Token);
            await process.StandardInput.FlushAsync(timeout.Token);
            var response = await ReadReplyAsync(process, timeout.Token);
            if (response.Error is not null || response.Text is null)
                throw new IOException(response.Error ?? "The PaddleOCR worker returned no result.");

            failed = false;
            return response.Text.Trim();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            StopWorker();
            throw;
        }
        catch (Exception ex)
        {
            failed = true;
            StopWorker();
            logger.LogWarning(ex, "PaddleOCR worker request failed.");
            throw new OcrEngineException("PaddleOCR could not read this page. Check the OCR worker configuration and API logs.", ex);
        }
        finally
        {
            if (temp is not null)
            {
                try { temp.Delete(recursive: true); }
                catch (IOException ex) { logger.LogWarning(ex, "Could not remove a PaddleOCR temporary file."); }
                catch (UnauthorizedAccessException ex) { logger.LogWarning(ex, "Could not remove a PaddleOCR temporary file."); }
            }
            gate.Release();
        }
    }

    private async Task<Process> GetWorkerAsync(CancellationToken ct)
    {
        if (worker is { HasExited: false } existing) return existing;
        StopWorker();

        var start = new ProcessStartInfo
        {
            FileName = Python!,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardInputEncoding = Utf8,
            StandardOutputEncoding = Utf8,
            StandardErrorEncoding = Utf8,
            CreateNoWindow = true,
        };
        start.ArgumentList.Add("-u");
        start.ArgumentList.Add(Script);
        var threads = Math.Clamp(configuration.GetValue("Ocr:Paddle:CpuThreads", 2), 1, 8)
            .ToString(System.Globalization.CultureInfo.InvariantCulture);
        start.Environment["RR_PADDLE_CPU_THREADS"] = threads;
        // Paddle controls its inference pool explicitly. Keep ancillary BLAS work single-threaded.
        start.Environment["OMP_NUM_THREADS"] = "1";
        start.Environment["MKL_NUM_THREADS"] = "1";
        start.Environment["OPENBLAS_NUM_THREADS"] = "1";
        start.Environment["PYTHONUTF8"] = "1";
        if (configuration["Ocr:Paddle:ModelDirectory"] is { Length: > 0 } modelDirectory)
            start.Environment["RR_PADDLE_MODEL_DIR"] = Path.GetFullPath(modelDirectory);

        var process = Process.Start(start) ?? throw new IOException("Could not launch the PaddleOCR worker.");
        worker = process;
        process.ErrorDataReceived += (_, args) =>
        {
            if (!string.IsNullOrWhiteSpace(args.Data)) logger.LogDebug("PaddleOCR worker: {Line}", args.Data);
        };
        process.BeginErrorReadLine();

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(
            configuration.GetValue("Ocr:Paddle:StartupTimeoutSeconds", 180), 1, 900)));
        var reply = await ReadReplyAsync(process, timeout.Token);
        if (!reply.Ready) throw new IOException(reply.Error ?? "PaddleOCR did not initialize.");
        return process;
    }

    private static async Task<WorkerReply> ReadReplyAsync(Process process, CancellationToken ct)
    {
        var line = await process.StandardOutput.ReadLineAsync(ct);
        if (line is null) throw new IOException("The PaddleOCR worker exited without sending a reply.");
        return JsonSerializer.Deserialize<WorkerReply>(line, JsonOptions)
            ?? throw new IOException("The PaddleOCR worker sent an invalid reply.");
    }

    private void StopWorker()
    {
        var process = worker;
        worker = null;
        if (process is null) return;
        try
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
        }
        catch (InvalidOperationException) { }
        catch (System.ComponentModel.Win32Exception ex) { logger.LogWarning(ex, "Could not stop the PaddleOCR worker."); }
        finally { process.Dispose(); }
    }

    public void Dispose() => StopWorker();

    private sealed record WorkerReply(bool Ready, string? Text, string? Error);
}
