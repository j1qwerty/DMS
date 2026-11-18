# Document Management System API (with the Record Room section)

ASP.NET Core 10 + EF Core 10 + SQL Server. This is the server side of the
record-room app; the frontend (`../record-room-frontend/`) is its only client.

## Running it

Requires .NET 10 SDK and a reachable SQL Server (Express is fine). Default
connection string targets `localhost` with Windows integrated security and
creates the `RecordRoom` database on first run.

```bash
cd src/RecordRoom.Api
dotnet run --urls http://localhost:5198
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
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-api.ps1 -BaseUrl http://localhost:5198
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-api.ps1 -SkipDestructive   # read-only pass
```

## Production deploy

Deployed to the Contabo VPS with `..\..\deploy-recordroom.ps1` (run from the
repo root; menu `1` API only, `2` web only, `3` both). Live at
`http://147.93.155.185:8083/` — web on nginx `:8083`, API on `127.0.0.1:5006`,
SQL Server database `RecordRoom`. The app applies migrations and seeds on
first boot, so no manual SQL step is needed once the `recordroom_app` login
exists (the deploy script creates it).

The real HTTP harness covers authentication, location guards, registry
validation, multi-file issue/partial return, audit and document access,
digitization versioning, custody, reports, dashboard aggregates and role access.
It also verifies the optional-module disabled state where the corresponding
feature flags are false. The current assertion count is intentionally not stated
here because it changes as the scope regression matrix is extended.

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

**The API is the authorization boundary.** Protected controllers now use
`RequirePermissionAttribute` against the server-owned four-role capability
matrix in `AuthService.PermissionsForRole`. Controller/action permissions
cover registry, file creation/editing, issue/return, location editing,
digitization upload/review, employees, users, audit, reports, document delete
and custody. The same permission names are mirrored in the frontend for
navigation only. Unit tests and the HTTP smoke harness cover direct API
denials; the frontend is never treated as the security boundary.

The matrix is intentionally static for this proposal; a database-editable
permission editor is a retained/deferred enhancement, not part of the current
department scope. The clause-by-clause status remains in
`../ZILA_PANCHAYAT_CODEX.MD`.

**No `EnableRetryOnFailure`.** EF Core's retrying execution strategy cannot be
combined with user-initiated transactions, and issue/return and location writes
depend on explicit transactions. Transaction correctness wins.

**`collectionTotal` is not `total`.** `total` is the filtered result count.
`collectionTotal` reports `Scope:ExpectedFileCount` when the Department has
approved a positive inventory total; otherwise it reports the actual number of
records in this database. No historical district volume is hard-coded.

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
| `Redis:ConnectionString` | empty | enables the Redis cache when set |
| `Hangfire:Storage` | `InMemory` | or `SqlServer` |
| `Hangfire:EnableScheduling` | `true` | register the recurring jobs on startup |
| `Hangfire:OverdueSweepCron` | `*/15 * * * *` | overdue sweep cadence, UTC |
| `Hangfire:AuditRetentionCron` | `30 2 * * *` | audit retention cadence, UTC |
| `Cors:AllowedOrigins` | `http://localhost:5172` | frontend origin |
| `Swagger:Enabled` | `true` | serve `/swagger` |
| `Features:BarcodeEnabled` | `false` | retained barcode module; env `Features__BarcodeEnabled` |
| `Features:MovementEnabled` | `false` | retained standalone movement log/report; env `Features__MovementEnabled` |
| `Features:SupportEnabled` | `false` | retained support/inquiry/media endpoints; env `Features__SupportEnabled` |
| `Features:BulkImportEnabled` | `false` | retained bulk CSV import endpoints; env `Features__BulkImportEnabled` |
| `Scope:ExpectedFileCount` | `0` | department-approved registry volume for collection total and mapped percentage; env `Scope__ExpectedFileCount` |
| `Scope:ExpectedPageCount` | `0` | department-approved page volume for the digitization percentage; env `Scope__ExpectedPageCount` |

Migrations and the seeder never crash the process: a database that is not
reachable yet is logged and reported by `/api/health` instead.

## Product scope and optional modules

The final department proposal and the complete clause-by-clause implementation
tracker are in `../ZILA_PANCHAYAT_CODEX.MD`. That tracker is the acceptance
source of truth for this branch.

Barcode, standalone movement history, support/inquiries/media, and bulk import
are retained modules outside the current user-facing proposal scope. They are
hidden by default, not deleted. All four API flags default to false and can be
enabled individually by an operator when authorized:

- `Features:BarcodeEnabled`
- `Features:MovementEnabled`
- `Features:SupportEnabled`
- `Features:BulkImportEnabled`

`GET /api/config` (anonymous) returns the app name and all four boolean feature
values. The frontend reads this configuration at startup in HTTP mode, so the
API setting takes precedence over build-time fallback flags.

Set `Scope:ExpectedFileCount` and `Scope:ExpectedPageCount` only after the
Department has confirmed the registry and page volumes. Until the expected
file count is approved, the registry uses the actual database count and mapped
percentage reports 0. Until the expected page count is approved, digitization
percentage reports 0. The dashboard exposes baseline-readiness booleans so the
web UI explains these states rather than implying false completion rates.

The deploy script starts new installations with both baselines at 0. On subsequent
deploys, zero/omitted command-line values preserve an existing positive baseline;
supply a new positive `-ExpectedFileCount` or `-ExpectedPageCount` only when the
Department approves a revised volume. To clear a value, edit the server environment
file deliberately rather than relying on a routine deploy.

The `AddFilesFullTextIndex` migration installs a SQL Server Full-Text catalog
and index over metadata fields when the SQL Server instance has the Full-Text
component installed. On instances without it, search safely falls back to the
existing metadata query. The per-page OCR-text index is created separately when SQL Server Full-Text Search is available; otherwise completed OCR text is searched through the fallback predicate. OCR recognition remains a separately blocked POC: the API stores and searches supplied text but does not extract text from PDF/image pixels.

When barcode is **off**:

- `api/barcodes/*` and `GET api/files/by-barcode/{barcode}` answer **404** ("Barcode features are turned off.");
- Files are identified by **file number**. Map upload, digitization page-add and similar calls accept a file number
  where they used to need a barcode; a number shared by several files is refused rather than guessed.
- New files get an internal id (the next `RF-##########`) and new shelves/almirahs derive one from their code, so no
  barcode has to be typed. The stored id still links maps, scans and history; nothing is migrated.
- Reports drop barcode columns and `barcodes.print` is not offered in permissions. Standalone movement history and the movement report are controlled by their separate flag. Bulk-import endpoints are independently controlled by their own flag.

Rows that carry only the internal id also carry `fileNumber` (issue lines, movements, digitization pages, map
pages), and map pages carry `fileId`, so screens never need a barcode lookup.

**Digitisation output:** `POST /api/files/{fileId}/digitization/final-pdf` composes the latest approved scan version for each page side into a new private `FinalPdf` document version. Source scans remain unchanged; each generated document stores SHA-256 and a JSON source manifest. The endpoint requires `digitization.review`. The current composition path imports approved PDF pages and places supported JPEG/PNG/GIF scan images on their selected paper size; it does not yet provide reorder/rotation tooling, quality gates, OCR text layers or PDF/A certification.

**OCR ingestion and search foundation:** `PUT /api/scans/{scanId}/ocr` stores a completed/failed OCR result for an uploaded scan page and requires `digitization.review`; `GET /api/scans/{scanId}/ocr` returns text and provenance to users with `digitization.view`. OCR text reads and updates are audited. Completed OCR text participates in `GET /api/files?search=...`; the API uses a SQL Server Full-Text index on FileScanPages when available and a fallback text predicate otherwise. The migration conditionally creates the OCR Full-Text index. **No OCR engine is included or invoked by this API yet**: a separate approved extraction worker/import must supply the text, and the Department must approve real Hindi/English sample accuracy before this can be called OCR-complete.

**Proposal gaps remain:** app-side storage and an e-office reference field do not constitute an e-office transfer. OCR extraction engine/worker and Hindi-English accuracy acceptance, automated image-quality gates, full Scan Studio editing and PDF/A certification are not yet complete. Final Department application handover remains a project delivery gate; see `../docs/DEPARTMENT-APPLICATION-HANDOVER.md`, `../docs/OPERATIONS-RUNBOOK.md` and `../ZILA_PANCHAYAT_CODEX.MD`.

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