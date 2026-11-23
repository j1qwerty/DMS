# Record Room DMS

The document register is the primary workspace. It manages records, versioned PDF attachments, page-level digitization, full-text search, review, exports, and the audit trail. The Record Room section tracks the corresponding physical files, their shelf locations, and issue, return, and movement history.

## Where to work

| Path | Responsibility |
| --- | --- |
| `record-room-frontend/` | React, TypeScript, Vite, and the asynchronous service contract in `src/services/contracts.ts`. `src/services/http/` calls the API. `src/services/impl/` provides the standalone demo. |
| `dotnet-api/src/RecordRoom.Api/` | .NET 10 API. Controllers authorize requests, application services enforce business rules, EF Core stores data in SQL Server, and SignalR refreshes open screens after changes. |
| `dotnet-api/tests/` and `dotnet-api/scripts/test-api.ps1` | Unit and SQLite flow tests, plus the live SQL Server HTTP harness. |
| `jhs_digitization-og-php-app/` | Reference-only legacy PHP implementation when present in the checkout. |
| `docs/` | [Architecture](ARCHITECTURE.md), [data model](DATA-MODEL.md), [security](SECURITY.md), and [private scan storage](scanned-document-storage.md). |

## Document versions and OCR

- **Document** shows independently stored attachments and built PDFs. The reader uses the selected version ID and source. It searches that PDF's text layer and its saved OCR. Opening the OCR panel replaces the right-hand version list with a selector above the reader, leaving the desktop PDF area the same width.
- **Full page** opens a reader route. **OCR** uses the same reader for stored documents and offers the Studio workspace as its own version choice. Left and right arrows change pages in these views and in the Studio page reader. Text inputs and dialogs keep their own keyboard behavior.
- **Edit in Studio** works with individual scan pages. It supports ordering, image enhancement, review, and building a versioned PDF. Built PDF previews read the text embedded at build time. Studio edits belong to the workspace until a new PDF is built.
- **Upload PDF** stores an attachment and queues recognition. Registering a new file with a PDF or adding a PDF in Studio also queues page import. The API responds after storing the original. Hangfire renders and recognizes pages in the background and saves per-page text in SQL Server. Scan rows keep their existing OCR column and registry search behavior.
- Document OCR reads serve the saved page map. Startup queues unfinished attachments and imports older OCR sidecars into the database. Page corrections win if they arrive during background generation. The private document directory holds original and derived files and should be backed up alongside SQL Server.
- **Re-run OCR** uses the engine selected when recognition starts. Studio reruns the current scan. The OCR tab queues a rerun for the selected attachment. A failed or blank rerun preserves saved text.

## Run locally

From the repository root, start the API in one terminal. It applies pending EF Core migrations on startup.

```powershell
dotnet run --project dotnet-api/src/RecordRoom.Api --urls http://localhost:5199
```

In another terminal, use Node.js 22+ and pnpm 10.15.0.

```powershell
cd record-room-frontend
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm install
pnpm dev
```

Use `VITE_API_MODE=http` and `VITE_API_BASE_URL=http://localhost:5199` in the frontend's `.env.local` for SQL Server-backed development. Set the mode to `local` for the standalone demo. See the [API README](../dotnet-api/README.md) for database and private storage settings.

## Deploy PaddleOCR on a CPU VPS

Tesseract remains the default and uses the existing `Ocr__TesseractPath`, `Ocr__TessDataPath`, and `Ocr__Languages` settings. PaddleOCR is optional. The Admin **Settings → OCR Engine** selector stores the choice in SQL Server's existing `FeatureSettings` table and audits changes. The selected engine applies to subsequent jobs and manual reruns.

PaddleOCR uses one long-lived local Python process per API instance. It starts when the selected engine first receives an image, loads the two models once, and handles one page at a time. It communicates with .NET over its standard input and output. It needs no GPU, Python web server, or separate port.

| PP-OCRv5 model | Published size |
| --- | ---: |
| `PP-OCRv5_mobile_det` | 4.7 MB |
| `devanagari_PP-OCRv5_mobile_rec` | 7.5 MB |
| Total | 12.2 MB |

The Devanagari model's vocabulary includes English letters and digits, so both scripts use the same recognizer. Model sizes exclude Python packages and working memory. [Detector and recognizer specifications](https://www.paddleocr.ai/v3.3.2/en/version3.x/pipeline_usage/OCR.html) · [Recognizer vocabulary](https://huggingface.co/PaddlePaddle/devanagari_PP-OCRv5_mobile_rec/blob/main/inference.yml)

Budget **1–2 GiB of RAM per worker** on the VPS to allow for larger pages, separately from the API and SQL Server. In a local Windows sample using the 1150 × 425 test image, the warm worker used about 281 MiB and peaked at 443 MiB. The eight-page sample averaged 1.39 seconds per image and used about two CPU cores during inference. VPS throughput will depend on CPU speed, image dimensions, and line count.

The published API contains `ocr-worker/paddle_worker.py` and `ocr-worker/requirements.txt`. From the published API directory on a supported x86-64 Linux host, install into a Python 3.11 or 3.12 virtual environment. Use the system's Python virtual-environment package and OpenCV shared-library dependencies such as `libgl1` and `libglib2.0-0` on Debian-based distributions.

```bash
python3 -m venv /opt/recordroom/ocr-venv
/opt/recordroom/ocr-venv/bin/python -m pip install -r ocr-worker/requirements.txt
/opt/recordroom/ocr-venv/bin/python ocr-worker/paddle_worker.py --warmup
```

Run the warmup under the API service account so its model cache is writable and visible to the API. Warmup downloads the two official models. For an offline deployment, provision the files in two subdirectories named exactly as in the table and set `Ocr__Paddle__ModelDirectory` to their parent.

```dotenv
Ocr__Paddle__PythonPath=/opt/recordroom/ocr-venv/bin/python
Ocr__Paddle__CpuThreads=2
# Ocr__Paddle__ModelDirectory=/opt/recordroom/ocr-models
# Ocr__Paddle__StartupTimeoutSeconds=180
# Ocr__Paddle__TimeoutSeconds=120
```

Set these in the API service environment or its `.env` file, restart the API, then select **PaddleOCR** in Settings. The process account needs access to Python, the models, and its temporary directory. Use `Hangfire__Storage=SqlServer` to retain queued jobs across API restarts. `Ocr__Enabled=false` disables OCR regardless of the selected engine.

## Verification commands

Run these from `record-room-frontend/` in this order.

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run these from `dotnet-api/`. The live contract tests and HTTP harness require an API backed by SQL Server on port 5199. Use a disposable demo database because the suites exercise write endpoints. Enable Barcode and Record Room in **Settings → Feature visibility** before running the frontend tests against that API. The PowerShell harness enables the feature groups for its own run and restores their starting values.

```powershell
dotnet build
dotnet test
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-api.ps1
```

The .NET suite includes opt-in native tests that use a mixed Hindi–English image. From `dotnet-api/`, point the tests at both installed engines before running them.

```powershell
$env:RR_TEST_TESSERACT = 'C:\Program Files\Tesseract-OCR\tesseract.exe'
$env:RR_TEST_PADDLE_PYTHON = 'C:\path\to\ocr-venv\Scripts\python.exe'
# Optional when the model cache has already been warmed under this account
$env:RR_TEST_PADDLE_MODELS = 'C:\path\to\ocr-models'
dotnet test --filter FullyQualifiedName~NativeOcrTests
```

For a browser check, register or open a file with two visibly different PDF versions. Open OCR, switch versions, and compare the page image and text. Open the OCR tab and Full page from the selected version, then check the page selector and arrow keys. Upload a multi-page PDF from the Document tab, New File, and Studio. Confirm the upload returns while processing runs, the expected Studio pages appear, and saved OCR and corrections survive a reload and API restart.
