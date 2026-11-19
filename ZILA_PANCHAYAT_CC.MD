# ZILA PANCHAYAT — capability & compliance tracker (ZILA_PANCHAYAT_CC)

Living tracker for the Zila Panchayat digitization engagement. It maps every
clause of the **final approved scope** (Sections 1.1–1.4 of the proposal sent
to the department) to what is implemented in this repository, where the
implementation lives, how it is verified, and what is deliberately hidden
behind a feature switch rather than removed.

- Scope source: final proposal Sections 1.1 (DMS software), 1.2 (physical
  record organization & digitization), 1.3 (department responsibilities),
  1.4 (assumptions & scope finalization).
- Status legend: **DONE** (implemented + verified in this build),
  **PARTIAL** (usable subset, gap listed), **HIDDEN** (built and working but
  switched off for this deployment — see §F), **PLANNED** (not yet built).
- Feature switches are grouped and Admin-controlled at
  *Settings → Feature visibility*; the API is the enforcement boundary
  (`GET /api/config`, `PUT /api/config/features`).
- Verification keys: **API** = `dotnet build` + `dotnet test` +
  `scripts\test-api.ps1` (live harness, needs SQL Server);
  **WEB** = `pnpm format:check` + `lint` + `typecheck` + `test` + `build`.

---

## §A — 1.1 Document Management System Software

| # | Scope clause (1.1) | Status | Implementation | Verification |
|---|---|---|---|---|
| A1 | Web login for authorized users, four roles: Admin, Supervisor, Operator, Employee | DONE | JWT login `POST /api/auth/login`, `LoginPage.tsx`; `Role` enum (`Domain/Enums.cs`), role claims in token; session + role gating in `services/permissions.ts`, `RouteGuards.tsx` | API: auth harness §Authentication, §Role-based access control; WEB: `services.test.ts`, `session-snapshot.test.ts` |
| A2 | Capability matrix deciding what each role may do | DONE (editable) | DB-backed `RolePermission` table + permission policies (`perm:{permission}`) replacing static role attributes; `GET /api/permissions/matrix`, `PUT /api/permissions/{role}/{permission}`; editable matrix UI in `admin/UsersPage.tsx`; Admin row locked server-side + last `users.edit` lockout guard | API: harness §Permissions matrix; WEB: `permissions.test.ts` |
| A3 | Audit stamps (who changed/uploaded what, when) | DONE | `AuditLog` table + `AuditWriter` (entity + audit + movement in one transaction); every write path stamps actor/role/IP/before/after | API: harness §Movement log and audit trail; WEB: `admin/AuditPage.tsx` |
| A4 | Login history | DONE | `LoginHistory` table, every attempt (success + failure) appended; admin viewer + CSV export + `login-history` report | API: harness §Audit; WEB: `admin/AuditPage.tsx` |
| A5 | Account controls | DONE | `UsersController` create/update/deactivate/remove, password hashing, activate/deactivate, self-service sign-out; PIN/OTP/recovery flows in `AuthService` | API: harness §Authentication; WEB: `admin/UsersPage.tsx` |
| A6 | Dashboard: registry size | DONE | `DashboardStatsDto.RegistryTotal` (legacy collection total reported honestly) | API: harness §Dashboard aggregates; WEB: `DashboardPage.tsx` |
| A7 | Dashboard: percentage of files mapped | DONE | `MappedPercent` (loaded vs legacy registry total) | API: harness §Dashboard; WEB: `DashboardPage.tsx` |
| A8 | Dashboard: files issued | DONE | `IssuedCount` (`Status == Issued`) | API: harness §Dashboard; WEB: `DashboardPage.tsx` |
| A9 | Dashboard: files due (+ overdue tracking) | DONE | `DueToday`, `OverdueCount`, borrower count; recurring `mark-overdue-receipts` Hangfire sweep | API: harness §Dashboard, §Issue/return; WEB: `DashboardPage.tsx` |
| A10 | Dashboard: digitization percentage | DONE | `DigitizationPercent` (approved pages / total pages) | API: harness §Dashboard; WEB: `DashboardPage.tsx` |
| A11 | Issue and return with multi-file receipts | DONE | `IssueReceipt` + `IssueLine` model; `POST /api/issues/issue` (one receipt, many files), `POST /api/issues/{id}/return` | API: harness §Multi-file issue and partial return; WEB: `IssuePage.tsx`, `ReturnPage.tsx` |
| A12 | Partial returns | DONE | Per-line return with condition notes; receipt status `Partially returned` | API: harness §Multi-file issue and partial return; WEB: `ReturnPage.tsx` |
| A13 | Borrower ledger | DONE | `GET /api/issues/borrowers` (open receipts per borrower) + `issue-register`/`return-register` reports | API: harness §Issue desk; WEB: `IssuePage.tsx`, `ReportsPage.tsx` |
| A14 | Due dates and overdue tracking | DONE | `DueAt` on receipts, overdue sweep job, `overdue-files` report | API: harness §Reports; WEB: `ReportsPage.tsx` |
| A15 | Upload of digitized documents to e-office, reference copy retained in the application | DONE | Full-PDF upload (`/api/files/{id}/documents`, versioned, SHA-256, reference copy in `App_Data/documents`); `EOfficeReference` on the file with `PUT /api/files/{id}/e-office-reference` + registry filter for linked/not-linked | API: harness §File registry, §Scan versions; WEB: `FileDetailPage.tsx`, `FilesPage.tsx` |
| A16 | Providing / configuring / integrating digitized files into the DMS | DONE | File-centric digitization: scan pages per file, review queue, approvals, e-office reference linking, generated PDF deliverables (§B8) | API: harness §File scan pages; WEB: `FileDetailPage.tsx`, `DigitizationPage.tsx` |
| A17 | Search across the digitized data AND the OCR text of digitized documents | DONE | SQL Server full-text search over `Files` metadata columns **and** `FileScanPages.OcrText` (one search box covers both; LIKE fallback when FTS is unavailable); in-memory adapter matches OCR text too | API: harness §Full-text search; WEB: `SearchPage.tsx`, `FilesPage.tsx`, `CommandPalette.tsx` |
| A18 | Audit trails recording who accessed/changed/uploaded a document and when | DONE | Access-side: content opens log audit rows (`document.viewed`); change-side: every upload/update stamps audit with actor + timestamp | API: harness §Audit; WEB: `admin/AuditPage.tsx` |

Notes on A17: the OCR *extraction pipeline* itself remains POC-gated on ~100
real district records (work plan §3.3 — engine choice must be proven on
stamped/faded carbon copies before commit). The schema (`OcrText`), the
full-text index over it, the search path and the seeding are in place, so
search covers OCR text from the moment extraction is switched on. Until then
`OcrText` is populated by seeded sample text and manual entry only.

## §B — 1.2 Physical record organization and digitization

| # | Scope clause (1.2) | Status | Implementation | Verification |
|---|---|---|---|---|
| B1 | Receiving, counting and secure handover of physical files with the department | DONE | Custody chain (`CustodyEvents`): intake register with declared vs reconciled count and variance, return events, `GET/POST /api/custody`, `POST /{id}/reconcile`, `POST /{id}/sign-off`; department sign-off recorded (signer + timestamp); audit-written | API: harness §Custody chain; WEB: `CustodyPage.tsx` |
| B2 | Preparation for scanning (unbinding, staples/pins, dusting, flattening) | TRACKED (physical work) | Preparation is physical labour, not software (work plan §3.8 / `Recordroom-features.md` §5). The software side records the handover state (B1) and a per-page note field; a prep checklist is deliberately not modelled | — |
| B3 | Scanning of agreed document sizes (A4/Legal, A3, A0/A1/A2) per page per side | DONE | `DocumentSize` (A0–A4, Other) per file and per scan page; page number + version per page; sheet side is implied by page numbering (one row per side; a duplex sheet is page 2k−1/2k) | API: harness §File scan pages; WEB: `FileDetailPage.tsx` page-scan form |
| B4 | Scanning output in PDF format that is legible, properly aligned and cropped | DONE | Uploads stored as PDF/images with SHA-256 integrity; **scan studio** provides rotate/deskew/despeckle/crop/contrast correction with original preserved (B6); deliverable PDFs generated from approved pages (B8) | API: harness §Scan studio; WEB: `ScanStudioPage.tsx` |
| B5 | Quality verification with correction or rescanning wherever required | DONE | Per-page review queue (approve / reject with reason) across files; rescan = next version (history kept); review-all per file; supervisor-only decisions | API: harness §File scan pages, §Scan review; WEB: `DigitizationPage.tsx` |
| B6 | Image quality gates: DPI rejection + enhancement | DONE | DPI read from image metadata at upload, below 200 DPI rejected with a field-level error (config `Quality:MinimumScanDpi`); enhancement operations (deskew, despeckle, binarise, crop, contrast, rotate) write a processed copy and keep the original (versioned provenance) | API: unit tests `ImageDpiTests`, harness §Scan studio; WEB: `ScanStudioPage.tsx` |
| B7 | Metadata creation and indexing (file number, date, subject, department) entered into the database for easy retrieval | DONE | Registry fields (file number, subject, department, year, kind) + indexed search; bulk CSV import for existing indexes; full-text indexed retrieval (A17) | API: harness §File registry, §Bulk import; WEB: `NewFilePage.tsx`, `admin/BulkImportPage.tsx` |
| B8 | Upload to e-office with reference copy stored in the application | DONE | E-office reference per file (A15) + generated PDF deliverable per file from approved pages (`DocumentDerivatives`), downloadable and archived in the application | API: harness §PDF generation; WEB: `ScanStudioPage.tsx`, `FileDetailPage.tsx` |
| B9 | Preparation and handover of agreed digital deliverables and supporting data, with department's sign-off on the digital handover | DONE | PDF deliverable per file (B8) + custody return event with digital-handover sign-off (B1) + 8 CSV reports (deliverable supporting data) | API: harness §Custody chain, §Reports, §PDF generation; WEB: `CustodyPage.tsx`, `ReportsPage.tsx` |

## §C — 1.3 Responsibilities of the department (process clauses)

These clauses are obligations of the department, not software. The system
supports each one; nothing here needs new code.

| # | Clause | System support |
|---|---|---|
| C1 | Nodal officer / departmental representatives for coordination | Nodal officer modelled as an Employee + login (any role); custody events name the department and vendor |
| C2 | Provide access to DMS, physical records, storage locations | Accounts + role capability matrix (A1/A2); custody intake register (B1) |
| C3 | Confirm file identification rules, metadata fields | Metadata fields are data-driven (file number, subject, department, year, size); bulk import template documents the agreed columns |
| C4 | Finalize file and page volumes, document sizes | `DocumentSize` per file/page; digitization-progress report tracks volumes |
| C5 | Provide workspace/furniture/electricity/connectivity | Out of software scope |
| C6 | Departmental resources for metadata finalization, classification, verification | Bulk import validation preview + review queue (B5/B7) |
| C7 | Review digitized batches within agreed period; communicate corrections | Pending-review queue with reject-with-reason (B5); audit trail records decisions |
| C8 | Provide access/interface specs/approvals for agreed integrations | E-office reference field + generated deliverables (B8) are the integration seam |
| C9 | Approve pilot process, quality requirements, reports, final handover | Quality gates (B6) + reports (B9) + custody sign-off (B1) are the approvable artefacts |

## §D — 1.4 Assumptions and scope finalization

Volumes, sizes, metadata fields, output formats, quality acceptance,
infrastructure responsibilities, handover and integration requirements are
confirmed jointly before work begins (proposal text). In the system these are
configuration, not code: `Quality:MinimumScanDpi`, `Features:*` switches,
`Hangfire:*` schedules, `FileStorage:RootPath`, output format is PDF
(PDF/A conformance level is a QuestPDF setting pending the contract wording —
work plan §3.6). Records needing special handling are flagged with per-page
notes (B2); anything outside scope is assessed separately (process).

## §F — Feature visibility (hide, not remove)

Final scope changed: capabilities that the Zila Panchayat deployment does not
need stay **built and tested but hidden**. Each switch is a group — turning it
on enables every related surface (sidebar entry, sub-nav tabs, routes, pages,
registry columns and the API endpoints behind them, which answer 404 while
the group is off).

| Group key | What the group bundles | Default (ZP) | Controlled by |
|---|---|---|---|
| `barcode` | Barcode centre (labels, QR, print jobs), scan-a-barcode validation page, barcode columns/inputs in registry, issue desk, new-file form; `by-barcode` API endpoints | **off** | Settings → Feature visibility (Admin) |
| `recordRoom` | Rooms & shelves pages, room detail/designer, locations administration tab, shelf placement / relocate forms, room-shelf registry filters, spine views | **off** | Settings → Feature visibility (Admin) |
| `maps` | Maps sidebar entry + admin maps page, map uploads and versions | **off** | Settings → Feature visibility (Admin) |
| `support` | Help & support page + inquiry endpoints | **off** | Settings → Feature visibility (Admin) |

Defaults are seeded into the `FeatureSettings` table (and readable via
`GET /api/config`), so a non-Zila deployment simply flips the switches on —
nothing is deleted. The Admin role owns the switches; the approved scope has
exactly four roles (Admin, Supervisor, Operator, Employee) and no separate
super-admin role, so "superadmin/admin" from the request maps to **Admin**.

## §V — v2 work plan status (docs/WORK-PLAN.md)

| v2 item | Status | Where |
|---|---|---|
| §3.1 FTS search at scale | DONE | FTS catalog + indexes on `Files` and `FileScanPages.OcrText`; LIKE fallback; §A17 |
| §3.2 Image quality gates | DONE | DPI rejection + OpenCvSharp5 enhancement ops (§B6) |
| §3.3 OCR pipeline | PLANNED (POC gate — needs ~100 real records from the department) | schema + search ready (§A17 note) |
| §3.4 Scan composition studio | DONE | gallery, reorder, replace/insert/delete/duplicate, rotate, enhance, compare (§B4/B6) |
| §3.5 PDF generation from scans | DONE | QuestPDF, ordered approved pages, invisible OCR text layer, header/footer + page numbers (§B8) |
| §3.6 PDF/A compliance | PLANNED (needs contract wording: QuestPDF cannot emit PDF/A-1; 2b recommended) | §D |
| §3.7 Editable permission matrix | DONE | §A2 |
| §3.8 Custody chain | DONE | §B1 |
| §3.9 Infrastructure hardening | PARTIAL | Redis/Hangfire SQL optional already; HTTPS domain + CI with SQL Server remain ops work |

## §T — Test coverage map (new/updated)

| Area | API unit tests (`RecordRoom.Api.Tests`) | API harness (`scripts/test-api.ps1`) | Web tests (vitest) |
|---|---|---|---|
| Feature switches (grouped, DB-backed) | `FeatureSwitchTests` (parse, defaults, DB overlay, 404 filter, WithFeatures) | §Feature switch groups — group matrix, admin-only writes, unknown keys, live state, restore | `features.test.ts` (groups, defaults, persistence, runtime merge), `features-and-rooms.test.ts` (build-time + API override) |
| Permission matrix (editable, enforced) | `FeatureSwitchTests.WithFeatures` (feature/permission intersection) | §Editable permission matrix — read gating, grant→200 on next request, revoke→403, Admin fixed, unknown role/permission | `permissions.test.ts` (store, `can()` sync, replace + notify) |
| Full-text search + OCR text | — (needs live FTS; the LIKE fallback shares the same predicate) | §Registry search + OCR text — `matchedVia=ocr` on a seeded OCR row | `services.test.ts` (existing registry suites) |
| Scan studio + quality gates | `ImageDpiTests` (JFIF dpi/dpcm/aspect, EXIF XResolution, PNG pHYs, GIF/PDF unknown, bad signatures) | §Scan studio + deliverable PDF — page create, image attach, order + foreign-id refusal, rotate validation, deskew, processed variant, revert, approve | `services.test.ts` (reorder, rotate, enhance, revert, duplicate, build, `%PDF` bytes) |
| PDF generation | — (QuestPDF composition runs in the harness against real pages) | §Scan studio + deliverable PDF — build, page count, listing, `%PDF` download bytes | `services.test.ts` (build + listPdfs + pdfBlob round-trip) |
| Custody chain (existing) | `DisplayTests` | §Custody chain (existing) | `services.test.ts` (existing) |

The harness turns the feature groups **on** after authentication (they seed
off — §F) and restores the seeded profile before the summary, so every hidden
group's endpoints are still exercised on each run. Unit-test totals: API 165
(was 146), web 132 passing.

## §R — Round 3 (2026-11-18) — UI corrections + final-scope closing

| Item | State | Where |
|---|---|---|
| Menu: Overview first; Maps/Help folded away; one Digitization entry with tabs | DONE | `Sidebar.tsx`, `MobileTabBar.tsx`, `DigitizationPage.tsx` (tab in URL), `/custody` redirects |
| Sidebar `permitted()` feature-check bug (Rooms/Maps/Help bounced to /files) | DONE (bug fixed) | `Sidebar.tsx` |
| Contrast: `@custom-variant dark` (dark: followed the OS, not the .dark class) + `--rr-accent-fill` white-text fills | DONE | `global.css`, `Button.tsx`, tabs, toggles, avatars |
| Logged-in user on topbar only | DONE | sidebar footer keeps Settings + sign-out |
| Permission matrix alignment | DONE | `UsersPage.tsx` table-fixed, widths, nowrap |
| Custody: batch prefilled `DIG-YYYYMMDD-HHmm` | DONE | `lib/batchRef.ts` (reusable) |
| Custody: Return… against an intake (partial/repeated), x/y column, view-details modal, signer names, counted-by stamps | DONE | `CustodyPage.tsx` + API `POST /api/custody/{id}/return`, `GET /{id}/returns`, `ReconciledBy/At` |
| Issue desk employee combobox; unmatched name saved as typed with notice | DONE | `EmployeeCombobox.tsx` + `IssuePage.tsx` |
| Departments CRUD (names + codes) + selects on employee/custody/file forms | DONE | `DepartmentsPage.tsx`, `DepartmentSelect.tsx`, API `/api/departments`, rename follows employees |
| Audit regrouped: Documents / Digitization / Logins & issues / File views | DONE | `AuditPage.tsx` + API `?group=` |
| File-view tracking (5-min per-user throttle) + `audit.fileViews` permission | DONE | `FilesService.RecordViewAsync`, `GET /api/audit/file-views` |
| Scan studio reachable (file page button) + `studio.use` permission (all four roles) | DONE | `FileDetailPage.tsx`, route guard, 8 endpoints re-gated |
| OCR run/display in the studio | DONE | `ScanStudioPage.tsx` + `POST /api/scans/{id}/ocr` |
| Hindi OCR: PDFium raster + tesseract hin+eng on upload and re-run; tessdata shipped | DONE + E2E-verified | `OcrTextExtractor.cs`, `TesseractOcrEngine.cs`, `tessdata/` (rendered Hindi page read exactly) |
| Dashboard: registry, % mapped, issued, due+overdue, digitization % | DONE | `DashboardPage.tsx` (five cards, scope order) |
| Deliverable regeneration tracking (who/when/pages/sha; per-edit audit) | DONE (existed; now visible in studio + digitization audit group) | `DocumentDerivative`, audit rows |
| Tests | DONE | web 154 (+20 round-3), API 171 (+6 extractor), harness +5 sections (departments, returns, file views, groups, studio.use) |

**Not verifiable here:** the PowerShell harness itself needs the user's Windows + SQL Server run (all sections follow the existing pattern; the API round-trips were unit-verified where logic is pure).
