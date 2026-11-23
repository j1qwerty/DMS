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

## Verification commands

Run these from `record-room-frontend/` in this order.

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run these from `dotnet-api/`. The live contract tests and HTTP harness require an API backed by SQL Server on port 5199.

```powershell
dotnet build
dotnet test
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-api.ps1
```

For a browser check, register or open a file with two visibly different PDF versions. Open OCR, switch versions, and compare the page image and text. Open the OCR tab and Full page from the selected version, then check the page selector and arrow keys. Upload a multi-page PDF from the Document tab, New File, and Studio. Confirm the upload returns while processing runs, the expected Studio pages appear, and saved OCR and corrections survive a reload and API restart.
