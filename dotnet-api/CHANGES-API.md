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
