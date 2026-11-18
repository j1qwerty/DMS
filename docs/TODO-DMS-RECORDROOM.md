> **Current status override (2026-11-18):** This checklist contains historic verification claims and must not be used as the current project sign-off. The binding scope/status is [`../ZILA_PANCHAYAT_CODEX.MD`](../ZILA_PANCHAYAT_CODEX.MD). Optional feature defaults have changed to OFF, and proposal items previously called “not planned” are now in scope.

# TODO: Document Management System + Record Room

Legend: `[x]` done and tested, `[ ]` not done.
**Historical checklist only.** This document predates the final Zila Panchayat proposal. Use `../ZILA_PANCHAYAT_CODEX.MD` for actual proposal coverage, status, missing features and acceptance tests. A completed screen or code path is not proof of contractual completion.

## Phase 1: Frontend (done)
- [x] Light sidebar that follows the theme
- [x] Product named "Document Management System"; Record room is an additional section in the same shell
- [x] Menu regrouped: Document management / Record room / Manage; related screens as page tabs
- [x] Documents (file table) is the home page; old dashboard is Overview
- [x] Full-page file and map viewer; Maps page; Rooms add / edit / delete UI
- [x] `VITE_ENABLE_BARCODE` switch (default off for current delivery) + page-by-page list in `.env.example`
- [x] Runtime override from `GET /api/config` (frontend side ready; falls back to the env value if the API lacks it)
- [x] Barcode hidden/replaced on: menu, mobile bar, Documents table + CSV, row menu, file detail, file viewer,
      Register file, Maps, Issue (works by file number), Return, Movement, Search, Rooms detail, Room layout,
      Digitization (file number), Bulk import labels, Reports columns, Settings permission list
- [x] `/scan` and `/barcodes` redirect to Documents when off
- [x] Tests: switch parsing and override, file lookup by number, room rules, report columns (118 passing)
- [x] Browser check with the switch on and off, desktop and phone width

## Phase 2: API (`dotnet-api/`): historical code inventory — final scope still requires acceptance testing and additional implementation
Verified here by compiling the whole API against stand-in packages and executing 59 unit/behaviour checks
(see "How this was verified"). **Not** yet run against the real NuGet packages or SQL Server: see Phase 3.

- [x] **API-1 Feature option.** `Features:BarcodeEnabled` (default `true`), env `Features__BarcodeEnabled`,
      parsed leniently (`false/0/off/no/disabled`), read on every call. In `appsettings.json`, the API README and
      `deploy-recordroom.ps1` (added to the env file without overwriting an existing choice).
- [x] **API-2 Config endpoint.** Anonymous `GET /api/config` returns `{ appName, features: { barcode } }`.
- [x] **API-3 Gate barcode endpoints** when off: `api/barcodes/*` and `GET files/by-barcode/{barcode}` answer 404
      "Barcode features are turned off." (`[RequireBarcodeFeature]`).
- [x] **API-4 Work by file number.** `IFileRefs.FindAsync` accepts a barcode or a file number (a shared number is
      refused, not guessed); used by map add and digitization page-add. `fileNumber` added to issue lines, movements,
      digitization pages and map pages; `fileId` added to map pages. List searches on maps, digitization batches and
      movements now also match file numbers.
- [x] **API-5 Create without barcodes.** File create generates the next `RF-##########` when no barcode is sent
      (off only); shelf and almirah create derive an internal id from the code (off only).
- [x] **API-6 Server-written sentences.** Movement details and the activity feed use the file number and hide the
      internal id when off.
- [x] **API-7 Reports.** Barcode columns and wording are dropped from definitions, screen and CSV when off.
- [x] **API-8 Rooms endpoints.** `POST/PUT/DELETE /api/locations/rooms`: unique name, generated never-reused
      `RM-###` code, delete refused while sections/almirahs/files exist, audit + realtime events, Admin/Supervisor only.
- [x] **API-9 Permissions.** `barcodes.print` is not offered (login and `/api/auth/me`) while the switch is off.
- [x] **API-10 Bulk import.** Messages say "ID" instead of "barcode" when off (CSV header names unchanged).
- [x] **API-11 Branding.** Swagger title "Document Management System API", `AppInfo.Name`.
- [x] **API-12 Tests.** xUnit: `FeatureSwitchTests`, `FileRefsTests`; `scripts/test-api.ps1` gained config, gating
      (by flag state) and room add/edit/delete/guard checks.
- [x] **API-14 Map upload fills a scan-less page in place** instead of leaving an empty "version 1" behind (matches
      what the frontend does after "add page").
- [x] **API-13 Final combined zip** (frontend + API) with docs and lock files.

## Phase 3: to check on your machine (NOT done here: no NuGet or SQL Server in my sandbox)
- [ ] `dotnet restore && dotnet build` the solution with real packages (expect no errors).
- [ ] `dotnet test dotnet-api/tests/RecordRoom.Api.Tests` (existing tests plus the two new files).
- [ ] Run the API and `pwsh dotnet-api/scripts/test-api.ps1` with `Features__BarcodeEnabled=true`, then again with `false`.
- [ ] Open the frontend in http mode with the switch off; walk Documents, Issue, Digitization, Maps, Rooms.
- [ ] `Program.cs` was changed (registrations, Swagger title) but could not be compiled here; check it builds.
- [ ] Dashboard activity is cached for 20 s, so a flipped switch can take up to 20 s to show there.

## How this was verified
- Whole API (except `Program.cs`, `AppDbContext`, seeder, jobs, migrations) compiled with the .NET 10 SDK against
  stand-in definitions of EF Core, Redis, JWT and CSV libraries. A clean rebuild passes; an injected error is caught.
- 59 checks executed: 46 for flag parsing, the 404 gate, permissions, report stripping and id helpers (the two new
  xUnit files, run through a small xUnit stand-in) and 13 service-level checks on an in-memory stand-in database
  (room add / edit / delete and their guards, code numbering, shelf id derivation, file lookup by number or id,
  DTO enrichment). Those 13 are not shipped, because they need the EF in-memory provider.

## Final proposal scope corrections
OCR extraction/search, e-office transfer, approved metadata indexing, composed PDF output, scan quality gates and backup/restore are requirements of the final proposal. Final application handover to the Department is a project delivery gate—not an in-app workflow—and remains open until recorded as accepted in `../ZILA_PANCHAYAT_CODEX.MD` and `DEPARTMENT-APPLICATION-HANDOVER.md`.

## Waiting on you
- [ ] Command palette: send the files and instructions; it was not in this repo and was not touched.
- [ ] Frontend: re-check Maps/Documents against the real API once Phase 3 passes (the HTTP mapper for map pages was
      fixed: it read `barcode` but the API sends `fileBarcode`).
