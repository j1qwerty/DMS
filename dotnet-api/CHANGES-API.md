# API changes (DMS + Record Room, barcode switch, rooms)

New: `Infrastructure/Features/FeatureFlags.cs` (flag + `[RequireBarcodeFeature]`), `Application/AppInfo.cs`,
`Application/Services/FileRefs.cs` (find by number, enrich rows, id helpers), `Api/Controllers/ConfigController.cs`.

| Area | Change |
|---|---|
| Config | `Features:BarcodeEnabled` (default on); `GET /api/config` |
| Gating | `api/barcodes/*`, `GET files/by-barcode/{barcode}` -> 404 when off |
| By file number | map add, digitization page-add accept a barcode or file number; list searches match file numbers |
| DTOs (additive, optional) | `fileNumber` on `IssueLineDto`, `MovementDto`, `DigitizationPageDto`, `MapUploadDto`; `fileId` on `MapUploadDto` |
| Create | file create generates the next `RF-` id and shelf/almirah derive an id from their code when barcodes are off |
| Reports / permissions | barcode columns dropped; `barcodes.print` not offered when off |
| Sentences | movement details and activity feed hide the internal id when off |
| Rooms | `POST/PUT/DELETE /api/locations/rooms` (Admin, Supervisor) |
| Maps | uploading a scan to a page registered without one fills it in place |
| Branding | Swagger title "Document Management System API" |
| Tests | `FeatureSwitchTests`, `FileRefsTests`; `scripts/test-api.ps1` extended |
| Deploy | `Features__BarcodeEnabled` added to the server env file by `deploy-recordroom.ps1` |

No database migration: the stored internal id stays and keeps maps, scans and history linked.
Existing clients keep working: every DTO change is an added optional field, every new input field is optional.

Verification and what is still to check on a machine with NuGet and SQL Server: `docs/TODO-DMS-RECORDROOM.md`.

## Round 4 — deliverable review, audit split, flow tests

| Area | Change |
|---|---|
| Deliverable review | `DocumentDerivative` gained `Status` ("Pending approval" on build; Approved / Rejected by a reviewer), `ReviewedBy`, `ReviewedAt`, `ReviewNote`. New endpoint `POST /api/files/{fileId}/pdf/{derivativeId}/review` (`perm:digitization.review`); a rejection requires a note, a reviewed build cannot be re-reviewed, a derivative of another file is 404. |
| Migration | `Round4_DerivativeReview` adds the four columns; existing rows backfill to **Approved** so pre-round-4 builds keep counting as deliverables. |
| PDF build (bug fixes) | QuestPDF 2026.9 stopped reading system fonts by default, which failed **every** build with a missing "Segoe UI" — the studio now sets `UseSystemFonts` + `ThrowOnMissingFontFamilies=false` and names the family as a plain string. A glyph gap in the invisible OCR layer (Hindi text without Devanagari fonts) no longer loses the deliverable: the build retries without the text layer and reports `includesOcrText` honestly. Both found by the new flow tests. |
| Audit groups | `logins` (Session rows only) and `issues` (IssueRecord + MovementEvent) join the group map; `logins-issues` still resolves. |
| Flow tests | `tests/RecordRoom.Api.Tests/Round4FlowTests.cs`: the real service classes against SQLite in-memory + a real on-disk document store — registration (row, occupancy, movement, audit), duplicate barcode, relocation, custody chain (intake → reconcile → partial returns → sign-off, actor assertions), issue → return, scan upload (bytes on disk, sha256, inline OCR) → review → build (real `%PDF` on disk) → review flow with history kept, reorder provenance, rescan versioning. SQLite is a test provider only; production stays SQL Server. |
| HTTP harness | `scripts/test-api.ps1` covers the review flow end-to-end (403 for employees, decision validation, reject-with-reason, re-review refused, rebuild + approve, history, foreign file 404) and the split audit groups. |
| Storage config (docs) | `FileStorage` is now explicit in `appsettings.json` with comments stating the defaults: `RootPath` (default `App_Data/documents`; relative → resolved against the API folder, absolute → used as-is) and `MaxUploadBytes` (48 MiB ceiling). Env overrides: `FileStorage__RootPath` / `FileStorage__MaxUploadBytes`. The effective root is logged at startup (`Document storage root: …`) — verified by booting the API with and without the override. README documents the keys-not-paths design and the OCR-storage behaviour. |

Frontend counterpart: `../record-room-frontend/CHANGES-FRONTEND.md` (round-4 section).
