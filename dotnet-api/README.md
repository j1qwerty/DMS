# Document Management System API (with the Record Room section)

ASP.NET Core 10 + EF Core 10 + SQL Server. This is the server side of the
record-room app; the frontend (`../record-room-frontend/`) is its only client.

## Running it

Requires .NET 10 SDK and a reachable SQL Server (Express is fine). Default
connection string targets `localhost` with Windows integrated security and
creates the `RecordRoom` database on first run.

```bash
cd src/RecordRoom.Api
dotnet run --urls http://localhost:5199
```

On startup the API applies EF migrations and, if the registry is empty, seeds
the demo dataset (3 rooms, 14 files, 3 batches, 4 receipts, 8 employees,
5 logins). Swagger is at `/swagger`, health at `/api/health`.

### Demo logins

All use the password `Demo@12345`.

| User | Role | Notes |
| --- | --- | --- |
| `admin` | Admin | every capability |
| `supervisor` | Supervisor | all but user management |
| `operator` | Operator | desk work: register, issue, return, upload |
| `employee` | Employee | read-only registry and reports |
| `deputy.ceo` | Supervisor | deactivated, to exercise the refusal path |

Mobile sign-in accepts PIN `1234`. OTP sign-in issues a code that is logged
server-side and never returned over HTTP.

## Tests

No browser involved. `scripts/test-api.ps1` drives the real HTTP surface against
a real database and exits non-zero on the first failed assertion.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-api.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-api.ps1 -BaseUrl http://localhost:5199
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-api.ps1 -SkipDestructive   # read-only pass
```

## Production deploy

Deployed to the Contabo VPS with `..\..\deploy-recordroom.ps1` (run from the
repo root; menu `1` API only, `2` web only, `3` both). Live at
`http://147.93.155.185:8083/` — web on nginx `:8083`, API on `127.0.0.1:5006`,
SQL Server database `RecordRoom`. The app applies migrations and seeds on
first boot, so no manual SQL step is needed once the `recordroom_app` login
exists (the deploy script creates it).

142 assertions covering auth, the location hierarchy guards, registry
validation, multi-file issue with a partial return, audit and movement trails,
digitization versioning, bulk classification, barcodes, reports, dashboard
aggregates and role-based access control.

### Linux / Ubuntu VPS Deployment & OCR Dependencies

The OCR path is platform-neutral: it shells out to the `tesseract` CLI with the same arguments on Windows and Linux (`tesseract <page.png> stdout -l hin+eng --psm 3`, with `--tessdata-dir` added when resolved). On Windows, it auto-detects `C:\Program Files\Tesseract-OCR\tesseract.exe` if not on PATH. On Ubuntu/Debian, `apt` packages provide the CLI and optional system models.

#### 1. System packages (Ubuntu / Debian VPS)

```bash
sudo apt-get update
# Tesseract CLI + Hindi and English language models
sudo apt-get install -y tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin

# Deliverable PDF builder (QuestPDF/Skia): font config + fonts (including Devanagari for Hindi text)
sudo apt-get install -y libfontconfig1 fonts-dejavu-core fonts-noto-devanagari

# Verify installation
tesseract --version && tesseract --list-langs
```

> **Note on fonts**: QuestPDF uses system fonts (`UseSystemFonts = true`). On minimal Linux images without `libfontconfig1`, PDF composition degrades. For Hindi text in deliverable PDFs, `fonts-noto-devanagari` (or `fonts-lohit-deva`) ensures clean Devanagari rendering.

#### 2. Models & tessdata lookup order

The repository ships `dotnet-api/tessdata/` (`eng.traineddata` + `hin.traineddata`), which `RecordRoom.Api.csproj` copies directly into the publish output directory. The lookup order is:
1. Configured path (`Ocr:TessDataPath`)
2. App folder (`AppContext.BaseDirectory/tessdata`)
3. Working directory (`./tessdata`, `./dotnet-api/tessdata`, `../../tessdata`)
4. Binary directory (`<tesseract-bin-dir>/tessdata`)
5. System locations (`/usr/share/tesseract-ocr/5/tessdata`, `/usr/share/tesseract-ocr/4.00/tessdata`, `/usr/share/tessdata`)

If you want to use the system models instead of the bundled files:
```bash
# Check location:
dpkg -L tesseract-ocr-hin | grep traineddata
# Set in /etc/recordroom/recordroom.env or .env:
Ocr__TessDataPath=/usr/share/tesseract-ocr/5/tessdata
```

#### 3. Native bits & container images

- **OpenCV**: The csproj references `OpenCvSharp5.official.runtime.linux-x64` unconditionally; `OpenCvSharp5.runtime.win` is wrapped in `Condition="$([MSBuild]::IsOSPlatform('Windows'))"`. Linux publishes get their native binaries automatically.
- **PDF rasterization**: `Docnet.Core` (PDFium) ships `linux-x64` native binaries.
- **Docker**: If containerizing `dotnet-api/`, include `tesseract-ocr`, `tesseract-ocr-eng`, `tesseract-ocr-hin`, `libfontconfig1`, `fonts-dejavu-core`, and `fonts-noto-devanagari` in the Dockerfile.

#### 4. Post-deploy verification

Check the health and engine status:
```bash
curl http://localhost:5006/api/config
```
The returned JSON includes an `ocr` block:
```json
{
  "ocr": {
    "enabled": true,
    "available": true,
    "engine": "tesseract",
    "languages": "hin+eng",
    "note": "Tesseract ready (hin+eng)."
  }
}
```
Setting `Ocr__Enabled=false` disables the entire OCR path if ever needed.

## Layout

```
Domain/          entities and enums, no framework dependencies
Application/     Result<T>, DTOs, display-name mapping, service interfaces
  Services/      one file per bounded area; all writes go through IAuditWriter
Infrastructure/
  Auth/          password hashing, JWT claims, realtime channel names
  Cache/         ICacheService with a Redis and an in-memory implementation
  Data/          DbContext, migrations, seeder
  Jobs/          Hangfire background jobs
  Realtime/      SignalR hub and publisher
Api/Controllers/ thin HTTP layer, one controller per resource
```

## Design notes

**Writes are audited in the same transaction as the data.** `IAuditWriter`
writes the audit row, the movement event and the changed entity together, then
publishes to SignalR after commit. There is no path that changes data without
leaving a trace.

**The API is the authorization boundary.** `[Authorize(Roles = ...)]` on every
mutating endpoint mirrors the capability matrix in
`../record-room-frontend/src/services/permissions.ts`. Hiding a control in the
frontend is UX, not access control; the smoke test asserts the server refuses
what the matrix withholds.

**No `EnableRetryOnFailure`.** EF Core's retrying execution strategy cannot be
combined with user-initiated transactions, and issue/return and location writes
depend on explicit transactions. Transaction correctness wins.

**`collectionTotal` is not `total`.** The registry table holds whatever is
actually loaded, but `PagedResult<FileDto>.CollectionTotal` reports the legacy
collection size (2,478,450) so the UI can label its window honestly instead of
implying it holds every record.

**Enums cross the wire as strings, on both serializer stacks.** Controller
actions return `IResult`, and `Results.Ok(...)` resolves to a minimal-API
`JsonHttpResult`, which formats with `ConfigureHttpJsonOptions` rather than
MVC's `AddJsonOptions`. Configuring only one leaves enums as integers on half
the endpoints. `Application/Display.cs` maps them to the exact status strings
the frontend contract uses (`"Partially returned"`, `"Under Digitization"`).

**Redis is optional.** `Redis:ConnectionString` empty or unreachable means the
in-memory cache is used and nothing else changes. A Redis fault mid-request is
logged and served from memory rather than surfaced.

**Hangfire is optional too.** In-memory storage by default so the app runs with
no extra infrastructure. Set `Hangfire:Storage` to `SqlServer` to persist jobs.

Two jobs are scheduled on startup, both UTC and both idempotent:

| Job | Default cron | What it does |
| --- | --- | --- |
| `mark-overdue-receipts` | `*/15 * * * *` | flags open receipts past their due date |
| `prune-old-audit` | `30 2 * * *` | drops audit and login rows older than a year |

Set `Hangfire:EnableScheduling` to `false` to start the API without registering
them — useful for a test run or a read-only replica. The cron expressions are
configuration, so a site can change the cadence without a rebuild.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `ConnectionStrings:Default` | localhost, integrated security | SQL Server |
| `Jwt:SigningKey` | dev placeholder | must be at least 32 characters |
| `Jwt:ExpiryMinutes` | `120` | token lifetime |
| `Database:MigrateOnStartup` | `true` | apply migrations on boot |
| `Database:SeedOnStartup` | `true` | seed when the registry is empty |
| `FileStorage:RootPath` | `App_Data/documents` (inside the API folder) | where uploaded scans, maps and studio-built PDFs live on disk; env `FileStorage__RootPath`. Relative → resolved against the API folder; absolute used as-is (`D:\RecordRoom\documents`). The effective path is logged as **`Document storage root`** at startup |
| `FileStorage:MaxUploadBytes` | `50331648` (48 MiB, hard ceiling) | per-file upload limit; env `FileStorage__MaxUploadBytes` |
| `Ocr:Enabled` | `true` | run the tesseract (hin+eng) pipeline on scan upload |
| `Redis:ConnectionString` | empty | enables the Redis cache when set |
| `Hangfire:Storage` | `InMemory` | or `SqlServer` |
| `Hangfire:EnableScheduling` | `true` | register the recurring jobs on startup |
| `Hangfire:OverdueSweepCron` | `*/15 * * * *` | overdue sweep cadence, UTC |
| `Hangfire:AuditRetentionCron` | `30 2 * * *` | audit retention cadence, UTC |
| `Cors:AllowedOrigins` | `http://localhost:5173` | frontend origin |
| `Swagger:Enabled` | `true` | serve `/swagger` |
| `Features:BarcodeEnabled` | `true` | barcode features of the record-room section; env `Features__BarcodeEnabled`; accepts `false`/`0`/`off`/`no`/`disabled` to turn off |

Migrations and the seeder never crash the process: a database that is not
reachable yet is logged and reported by `/api/health` instead.

### Files on disk, keys in the database

The database never stores file paths. Every upload (scan page, map, record
document) and every studio-built deliverable PDF is written under
`FileStorage:RootPath` under a generated key (`<guid>.<ext>`); the tables carry
only that `StorageKey` plus size / content type / SHA-256. Two consequences
worth knowing:

- moving the library is a folder copy plus one config change (`FileStorage__RootPath`)
  — no database edit, because no row ever names a location;
- a stored key is not a path, so nothing a client uploads can address a file
  outside the root.

Back up the database **and** the storage folder together: a row without its
bytes shows an honest "no stored document" in the UI, and bytes without rows
are unreachable.

### OCR text is stored, not re-derived

The tesseract (hin+eng) pass runs **once**, when a scan's document is attached
(`FileScanPages.OcrText`), or when someone explicitly re-runs OCR
(`POST /api/scans/{id}/ocr`). Reads never re-OCR: the registry search matches
the stored column, and the studio shows the stored text; the deliverable PDF
embeds it once at build time as the invisible text layer.

## Barcode switch and product config

The product is a Document Management System; the record room (physical files, rooms, barcodes)
is an additional section. `Features:BarcodeEnabled` turns the barcode part on or off (default on).

`GET /api/config` (anonymous) returns `{ "appName": "Document Management System", "features": { "barcode": true } }`.
The frontend reads it at startup, so changing the setting needs no frontend rebuild.

When it is **off**:

- `api/barcodes/*` and `GET api/files/by-barcode/{barcode}` answer **404** ("Barcode features are turned off.").
- Files are identified by **file number**. Map upload, digitization page-add and similar calls accept a file number
  where they used to need a barcode; a number shared by several files is refused rather than guessed.
- New files get an internal id (the next `RF-##########`) and new shelves/almirahs derive one from their code, so no
  barcode has to be typed. The stored id still links maps, scans and history; nothing is migrated.
- Reports drop barcode columns, `barcodes.print` is not offered in permissions, movement and activity sentences no
  longer lead with the internal id, and bulk-import messages say "ID".

Rows that carry only the internal id now also carry `fileNumber` (issue lines, movements, digitization pages, map
pages), and map pages carry `fileId`, so screens never need a barcode lookup.

## Rooms

`POST /api/locations/rooms`, `PUT /api/locations/rooms/{id}`, `DELETE /api/locations/rooms/{id}` (Admin, Supervisor).
Name is required and unique (case-insensitive); the code is generated (`RM-001`, ...) and never reused; delete is
refused while the room has sections, almirahs or files. All three are audited and announced on the locations channel.

## Real-time

Hub at `/hubs/recordroom`. A client calls `Subscribe(channels)` with the
channels its view depends on (`files`, `locations`, `issues`, `movements`,
`digitization`, `audit`, `dashboard`, `uploads`). Every connection joins
`dashboard` automatically, so the stat cards stay live on every screen.

A write publishes `notification` to its channel and to `dashboard`, after
clearing the cached aggregates so a client that refetches on the notification
cannot read a count one write stale. Publishing is best-effort: a SignalR
failure never fails a write that already committed.