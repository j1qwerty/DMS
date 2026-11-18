# Zila Panchayat DMS — final-scope implementation tracker

**Scope authority:** the final proposal supplied in this conversation (sections 1.1–1.4). Where older plans, README files, UI labels, or implementation notes conflict with that proposal, this document takes precedence.

**Working branch:** `zila_codex`  
**Branch base:** `v2` commit `b0113c1d6c90fe6b98c53a13c3e3f1cc630910da` at branch creation  
**Review date:** 18 November 2026  
**Production target:** SQL Server-backed web application  
**Isolation rule:** all work is committed directly to `zila_codex`; no later `v2` changes are merged, cherry-picked or rebased into this branch. Draft PR #1 targeting `zila_codex` from `v2` was closed without merge.  
**Tracking rule:** every subsequent implementation PR/commit must update the status, evidence, tests and open acceptance criteria in this file.

> **Current overall status: PARTIAL — not yet proposal-complete.** The core DMS register, four-role authentication, issue/return, in-app document storage, digitisation review and physical custody register exist. The final software handover to the Department is a project delivery and acceptance activity, not an application feature. A department-ready handover pack, production deployment verification, backup/restore evidence, user/admin documentation, training, UAT sign-off and support transition are still to be completed. E-office transfer, OCR extraction/search, technical image-quality gates, full Scan Studio and PDF/A certification remain open. Do not describe the product as proposal-complete until all acceptance conditions pass.

## 1. Status definitions

| Status | Meaning |
|---|---|
| **DONE** | Implementation exists and matches the requirement at the level described. |
| **PARTIAL** | A useful implementation exists, but contractual behavior, security, integration or acceptance details remain. |
| **PENDING** | Not implemented, or dependent on information/approval not yet supplied. |
| **EXTERNAL** | Operational responsibility performed by the Department or Service Provider, not a software feature. |
| **TEST ADDED / NOT RUN** | Verification was added or identified, but no successful run is recorded on this branch. |
| **BLOCKED** | Cannot be safely completed until a department decision, interface specification, data volume or approval is supplied. |

A route, button, database field, or mock adapter alone is not evidence that an end-to-end requirement is DONE. Mark DONE only after the server behavior, UI behavior, authorization and relevant tests are all verified.

## 2. Branch changes already made for this final scope

| Change | Status | Notes |
|---|---|---|
| Created `zila_codex` from `v2` | DONE | Keeps `main` untouched. The branch includes the custody API and UI commits present on `v2`. |
| Central runtime product configuration | DONE / TEST NOT RUN | `GET /api/config` now reports barcode, movement, support and bulk-import switches. |
| Retained non-scope modules instead of deleting them | DONE | Barcode workflows, standalone movement log/report, support/inquiries/media links and bulk import remain in source. |
| Disabled-by-default optional modules | DONE / TEST NOT RUN | API configuration and web fallback defaults are false; API endpoints are guarded and frontend navigation/routes are hidden. |
| Document-open audit events | DONE / TEST NOT RUN | Opening file attachments, digitisation scan content and map scan content writes an `Access` audit event. New enum value `Access = 11` is appended without renumbering existing values. |
| Intake reconciliation before sign-off | DONE / TEST ADDED | An inbound custody event cannot be signed off until a reconciliation count exists; harness checks premature sign-off refusal. |
| Legal document-size option | DONE / TEST ADDED | Legal added alongside A0/A1/A2/A3/A4/Other in file and scan size validation/UI; harness registers and composes a Legal-size scan. |
| Dashboard metric corrections | PARTIAL / TEST ADDED | Mapped percentage counts files with a shelf placement against `Scope:ExpectedFileCount`; digitisation percentage counts approved PDF pages against `Scope:ExpectedPageCount`; both remain 0 until a positive department-approved denominator is set. Registry `collectionTotal` uses the approved file count or actual loaded DB count—no hard-coded district total. Due counts count outstanding file-lines, not receipts. |
| Metadata full-text search | PARTIAL / TEST ADDED | `20261118000400_AddFilesFullTextIndex` conditionally creates a SQL Server Full-Text catalog/index for registry metadata when the component is installed; API uses safe `CONTAINS` terms when active and falls back otherwise. The migration and SQL condition tests are added; OCR extraction/indexing is not present. |
| Digital handover workflow | PARTIAL / TEST ADDED | SQL-backed API, migration, immutable manifest, PDF SHA-256 verification, metadata CSV, handover receipt JSON, ZIP export, size cap, delivery state and Department accept/reject sign-off are implemented. UI is integrated beside physical custody; local demo explicitly does not fabricate official receipts. |

## 3. Final proposal 1.1 — DMS software

| # | Requirement | Existing implementation / evidence | State | Remaining work and acceptance condition |
|---|---|---|---|---|
| 1.1.1 | Web login for authorized users | ASP.NET authentication and React session flow. Four role names exist: Admin, Supervisor, Operator and Employee. | DONE | Run the full role login and access test matrix on SQL Server. Verify inactive account, failed password and logout behavior. |
| 1.1.2 | Capability matrix for each role | The API enforces a server-owned Admin/Supervisor/Operator/Employee capability matrix with `RequirePermission` policies; the frontend mirrors the same permission names for UX. File, issue/return, locations, digitisation, reports, custody, document and audit operations are gated server-side. | DONE / TEST ADDED | Run the complete live HTTP role/action matrix against SQL Server and inspect every endpoint for bypasses. The final proposal does not require an Admin-editable permission editor; DB-editable grants remain an optional enhancement, not a delivery blocker. |
| 1.1.3 | Audit stamps | Write services use `IAuditWriter`; entries contain actor, role, timestamp, IP, before/after values and summary. File/scan/map content opens are audit-written. | PARTIAL / TEST ADDED | Verify all remaining document read/download/export, upload, deletion, metadata and permission events. Run the handover export-audit assertion and verify ordinary users cannot alter/delete audit rows. |
| 1.1.4 | Login history | Success/failure/sign-out history, login channel, IP/client and Admin/Supervisor audit view exist. | DONE | Re-run positive, negative, deactivated-user, OTP/PIN and sign-out tests. Confirm user-facing privacy policy for stored IP/client data. |
| 1.1.5 | Account controls | Admin user create/update/deactivate/delete and role assignment exist. | DONE | Verify password reset, account lock/deactivation, last-admin safety and all four role cases. |
| 1.1.6 | Dashboard — registry size | `Scope:ExpectedFileCount` is the department-approved registry baseline; when it is unset, the registry/dashboard report the actual loaded database count. | PARTIAL | Department must reconcile and configure the final inventory. No hard-coded historical collection total is used. |
| 1.1.7 | Dashboard — percentage of files mapped | This branch defines mapped as a file assigned to a physical shelf and counts files with `ShelfId != null`; percentage uses the positive `Scope:ExpectedFileCount` baseline. | PARTIAL | Department must confirm that “mapped” means physical shelf placement (not a map drawing or scanned map). Until the denominator is approved, the dashboard reports 0% with a baseline warning. |
| 1.1.8 | Dashboard — files issued | Counts files currently in Issued status. | DONE | Verify it reconciles with all open issue receipt lines on live data. |
| 1.1.9 | Dashboard — files due | Counts each unreturned file-line whose receipt due date is within the dashboard due window. A 5-file receipt contributes 5 due files, not 1. | DONE / TEST ADDED | Run the smoke test which creates one receipt with multiple due files and verifies the line count. Confirm the department's due-day boundary (today only vs overdue plus today). |
| 1.1.10 | Dashboard — digitization percentage | This branch calculates the sum of approved PDF page counts divided by `Scope:ExpectedPageCount`, capped at 100%. | PARTIAL / BLOCKED | Department must finalize the expected total page volume. Set `Scope__ExpectedPageCount` in the API environment. Until then, dashboard intentionally reports 0% and exposes that the baseline is not configured. |
| 1.1.11 | Issue and return | Multi-file receipt, partial returns, borrower list/ledger, due dates and overdue status/job exist. | DONE | Run issue/partial-return/final-return/overdue tests under concurrent requests and ensure file and receipt states remain consistent. |
| 1.1.12 | Upload digitized documents to e-office | App-side private document storage, versioning, SHA-256 and content view/download exist. File metadata includes optional e-office reference, searchable/filterable in the registry. There is no real e-office transfer/API integration yet. | PARTIAL / BLOCKED | Department to supply interface specs, endpoint/network access, authentication, file-size/type rules, acknowledgement ID, retry policy, and test environment. Then implement real upload, transfer state, idempotency and reconciliation. An e-office reference field alone is not an upload. |
| 1.1.13 | Retain reference copy in this application | Private versioned file storage retains the original upload with content metadata/hash. | DONE for in-app copy | Verify backup/restore, storage encryption, access policy, retention, and consistency between SQL metadata and blob storage. |
| 1.1.14 | Provide/configure/integrate digitized files into the DMS | Registry metadata, private file-level attachments, scan pages, content endpoints and a first version of approved-scan-to-final-PDF composition exist. Generated PDFs are separate versioned records with SHA-256 and source manifests. | PARTIAL | Complete Scan Studio (reorder/rotate/replace/insert/delete), validate image and PDF rendering on representative departmental scans, add quality gates, secure in-app reader acceptance and production storage/backup procedures. |
| 1.1.15 | Search digitized data | Registry search has a conditional SQL Server Full-Text catalog/index migration over file number, subject, department, location, area, e-office reference, holder and description. API builds bounded safe prefix terms for `CONTAINS` when the index is active and falls back if Full-Text Search is unavailable. | PARTIAL | Execute/verify the migration on the target SQL Server with Full-Text Search installed; confirm indexing/population and Hindi-English relevance with the Department; add relevance ranking and realistic 25-lakh-row query/load tests. Date metadata remains to be agreed and added if needed. |
| 1.1.16 | Search OCR text of digitized documents | OCR text extraction and indexing are not implemented. Existing search does not search PDF/image contents. | PENDING / BLOCKED | Complete OCR engine POC on approximately 100 representative departmental scans (including faded/stamped/carbon-copy records), get approval, persist OCR text with page/source references, and include it in permission-filtered full-text search. No cloud OCR without written government approval. |
| 1.1.17 | Audit access/change/upload and timestamps | Change/upload writes are audited; file, scan and map content opening now writes `Access`. | PARTIAL / TEST ADDED | Verify every read path, report/export, image preview, download and bulk operation. Access audit must identify actor, document ID/version, action and timestamp. |

## 4. Final proposal 1.2 — physical record organization and digitization

| # | Requirement | Existing implementation / evidence | State | Remaining work and acceptance condition |
|---|---|---|---|---|
| 1.2.1 | Receive physical files from department | Custody register stores inbound/intake events, department, file count, batch reference, recorder and remarks. | PARTIAL | Add an item-level receipt manifest (file number or temporary tag per physical file), condition/exception notes and receipt acknowledgement. Reconcile manifest count with aggregate count. |
| 1.2.2 | Count files and secure handover | Custody reconciliation stores a counted number; this branch requires reconciliation before intake sign-off. | PARTIAL / TEST ADDED | Test mismatch handling, recounts, damaged/missing records, immutable handover signature/time and department representative identity. |
| 1.2.3 | Prepare documents for scanning (unbinding, remove staples/pins, dust, flatten creases) | Physical work is not performed by the application. No verified digital preparation checklist was found. | EXTERNAL / PARTIAL | Service Provider must perform physical preparation. Add a batch checklist/evidence record only if the department requests software evidence for each preparation step. |
| 1.2.4 | Scan A4/Legal, A3 and A0/A1/A2 per page per side | File/scan size options include A0/A1/A2/A3/A4/Legal/Other. This branch adds explicit Front/Back identity to each page row, a backward-compatible SQL migration, and page-side-specific versioning/uniqueness. | PARTIAL | Add scanner DPI/color mode/orientation metadata and verify actual per-side capture from the scanners. Confirm actual A0/A1/A2 scanner capability and supported file-size limits with operator equipment. |
| 1.2.5 | PDF output that is legible, aligned and cropped | This branch composes the latest approved Front/Back scan for each page side into a separate versioned final PDF. Multi-page source PDFs are imported; JPEG/PNG/GIF page images are fitted onto the selected paper size and centered; originals remain stored unchanged. | PARTIAL / TEST ADDED | Run live composition test on SQL Server and real scans. Add Scan Studio page reorder/rotate/replace/insert/remove, image crop/deskew and legibility verification. The current PDF composer is not a quality gate and does not certify PDF/A. |
| 1.2.6 | Quality verification, correction or rescanning | Scan review queue supports Pending/Approved/Rejected, rejection reason, rescan versioning and file-level review-all. | PARTIAL | Add measurable image-quality gates (minimum DPI, blur/contrast/blank-page/rotation/deskew/crop checks), per-page issue flags and rescanning workflow. Supervisor review must not replace technical acceptance checks. |
| 1.2.7 | Metadata creation/indexing (file number, date, subject, department) | Registry stores file number, subject, department and year; related fields can be searched. No explicit document date field or department-approved configurable schema was confirmed. | PARTIAL | Agree metadata dictionary with Department, add document/date fields where required, validation, mandatory-field rules, bulk reconciliation and full-text index integration. |
| 1.2.8 | Upload to e-office; retain reference copy in app | App-side copy/versioning and e-office reference text field exist; external transfer does not. | PARTIAL / BLOCKED | Implement only after written interface specification and credentials/test access. Keep transfer state and e-office receipt/reference tied to immutable app copy/hash. |
| 1.2.9 | Complete application, source code and technical documentation handover to the Department | The repository contains the React frontend, .NET API, SQL Server EF migrations, deployment scripts and engineering documentation. A dedicated Department handover checklist/runbook is being prepared. | PENDING | Freeze a tested release tag; provide source code and build/publish artefacts; transfer repository ownership/access; hand over database schema/migrations, environment/configuration inventory, architecture/data dictionary, deployment and rollback runbook, security/access matrix, backup/restore evidence, known-issues register and third-party licence inventory. Never put secrets in Git; transfer them through an approved secure channel. |
| 1.2.10 | Department acceptance, training and operational takeover | No verified Department UAT certificate, training completion record, production operations transfer or support acceptance is present in the repository evidence reviewed. | PENDING | Deploy to Department-approved infrastructure; complete role-based UAT and defect closure; reconcile migrated registry counts; demonstrate monitoring and backup/restore; train Admin/Supervisor/Operator/Employee users and IT support; hand over runbooks and escalation contacts; obtain signed UAT, production go-live and operational takeover certificates. Agree warranty/support period and SLA before sign-off. |

### Scanning and archival acceptance checks

- Every physical page side is represented exactly once in the approved page manifest.
- Original uploaded image bytes are immutable and retained; enhancement creates a derivative, never overwrites the source.
- Page order and rotation are explicit and reproducible.
- Each output PDF is readable, aligned, cropped, opens successfully and has the agreed page count.
- Rejected pages carry a reason and a rescan/version reference.
- A final package includes source manifest, output PDF(s), metadata and cryptographic checksums.
- PDF/A level and validation tool are agreed with the Department before claiming archival conformity.

## 5. Final proposal 1.3 — Department responsibilities

These are external prerequisites, not capabilities the application can independently satisfy.

| # | Department responsibility | State | Evidence / dependency to track |
|---|---|---|---|
| 1.3.1 | Nominate nodal officer and representatives | EXTERNAL | Capture names, roles, contact details and written nomination. |
| 1.3.2 | Provide DMS, physical records and storage access | EXTERNAL | Access approvals, security rules, site visit and inventory handover record. |
| 1.3.3 | Confirm file identification rules and metadata fields | BLOCKED | Approved field dictionary, identifiers, duplicate policy and sample records. |
| 1.3.4 | Finalize file/page volumes and sizes | BLOCKED | Signed volume estimate split by A4/Legal/A3/A2/A1/A0 and page-side counts. |
| 1.3.5 | Provide workspace, furniture, power, connectivity and facilities | EXTERNAL | Site readiness checklist and written responsibility matrix. |
| 1.3.6 | Provide resources for metadata finalization, classification and verification | EXTERNAL | Named reviewers, expected daily review rate, escalation path and approval SLA. |
| 1.3.7 | Review digitized batches and communicate corrections in agreed period | EXTERNAL / PARTIAL | Agree SLA and expose batch review/return-for-correction workflow in application. |
| 1.3.8 | Provide interface specs/access/approvals for existing departmental system integration | BLOCKED | e-office/DMS API/interface documentation, credentials, network/firewall approvals, test tenant and security approvals. |
| 1.3.9 | Approve pilot, quality, reports and final application handover arrangements | BLOCKED | Signed pilot/UAT acceptance, DPI/quality thresholds, sample PDF, reports, Department infrastructure, backup/restore responsibility, training schedule, support SLA and application handover/sign-off form. |

## 6. Final proposal 1.4 — assumptions and scope finalization gate

**No production digitization run should be treated as acceptance-ready until the following are finalized and recorded.**

| Decision | Current state | Required evidence |
|---|---|---|
| Total physical file volume | PENDING | Signed count and reconciliation baseline. |
| Total page and page-side volume | PENDING | Signed estimate by record type and paper size. |
| Document sizes | PARTIAL | Current app supports A0/A1/A2/A3/A4/Legal/Other; Department confirms actual volume and scanner handling requirements. |
| Metadata fields | PENDING | Approved metadata dictionary with type, mandatory/optional, validation and example values. |
| File identification and duplicate rules | PENDING | Approved unique key and exceptions handling. |
| Expected total page volume | PENDING | Signed expected page count used as dashboard denominator. |
| Output formats | PARTIAL | App stores uploaded PDF/images; final generated PDF, archival format, metadata export and package format remain to be agreed. |
| Quality acceptance procedure | PENDING | Signed DPI/legibility/crop/alignment/rotation/blank-page/approval thresholds and sample acceptance. |
| Infrastructure responsibilities | PENDING | Server, database, storage, backup, network, scanning workstation and security responsibility matrix. |
| e-office integration | BLOCKED | API/interface specification, access, credentials, test environment and approval. |
| Application/source handover | PENDING | Release/tag, source and build artefacts, SQL schema/migrations, configuration inventory, technical/user/admin documentation, backup/restore evidence, licence inventory, secure credential transfer and signed acceptance checklist. |
| Special-handling records | PENDING | Pre-processing list for fragile, bound, oversized, damaged, confidential or restricted records. |
| Out-of-scope records | PENDING | Assessment and change-control process for exceptional records. |

## 7. Existing modules retained but hidden from users

The updated direction is **hide, do not delete**. These modules remain in code, tests, data model and migrations. They are unavailable to users by default and must be re-enabled deliberately.

| Retained capability | API flag | Frontend flag | Default |
|---|---|---|---|
| Barcode scanner, label center and barcode APIs | `Features:BarcodeEnabled` | `VITE_ENABLE_BARCODE` | OFF |
| Standalone movement history/report | `Features:MovementEnabled` | `VITE_ENABLE_MOVEMENT` | OFF |
| Support/inquiries/media links | `Features:SupportEnabled` | `VITE_ENABLE_SUPPORT` | OFF |
| Bulk CSV import | `Features:BulkImportEnabled` | `VITE_ENABLE_BULK_IMPORT` | OFF |

Implementation rules:
1. A disabled feature must be absent from navigation and direct frontend routes.
2. API endpoints must reject direct access while disabled (404 is intentional to hide the module).
3. Related optional report definitions must not be listed or executable while disabled.
4. Do not remove their entity models, migrations, service implementations or tests.
5. Core proposal work must not depend on any hidden optional module.
6. The deployed API configuration is authoritative for HTTP mode; local frontend flags are fallback/development settings.
7. Any production re-enable must be recorded in a change note and tested with permissions.

## 8. Cross-cutting acceptance and security requirements

| Area | Current state | Acceptance work |
|---|---|---|
| Four-role authentication | DONE / TEST | Live API test all roles and account-state cases. |
| Server-side permissions | DONE / TEST ADDED | Four-role capability matrix is enforced server-side across the reviewed controllers; frontend mirrors the permission names. Run the live SQL Server role/action harness before final acceptance. A DB-editable matrix is not explicit in the final proposal and is not treated as a compliance gap. |
| File/document access | PARTIAL | Check authorization before content stream; audit view/download; no public blob URLs. |
| Audit integrity | PARTIAL | Protect audit data against user update/delete; verify all CRUD, access and export actions. |
| SQL Server data integrity | PARTIAL | Verify migrations, unique constraints, transaction handling and concurrency for issue/return, file upload/version and custody/handover. |
| Private storage | PARTIAL | Verify encryption, file type/size validation, malware scanning, backup/restore and DB/blob consistency. |
| Search scale | PARTIAL | Metadata SQL Server FTS index/query path implemented with fallback; OCR-text indexing, ranking/query-plan review and realistic load test remain. |
| OCR | PENDING | POC on real representative scans, on-prem deployment and permission-filtered indexing. |
| PDF generation | PARTIAL / TEST ADDED | API composition for approved page-side scans creates a versioned private final-PDF derivative with page count, SHA-256 and source manifest. The frontend offers the action to reviewers on API mode. Live image/PDF rendering acceptance remains pending. |
| Image quality | PENDING | DPI, skew, contrast, blur, blank-page, crop and orientation checks. |
| e-office | BLOCKED | Integration only after approved interface details. |
| Application handover | PENDING | Department release package, production deployment, source repository ownership/access, database and backup/restore, configuration/secrets transfer, documentation, training, UAT/go-live acceptance and operational support transition. This is a project delivery activity, not an app feature. |
| Deployment | PARTIAL | Validate environment defaults, SQL Server connection, persistent documents directory, TLS, backup and restore on target server. |

## 9. Test plan and missing-feature regression matrix

### 9.1 Tests already present or added in this branch

| Test | Location | Status |
|---|---|---|
| SQL Server migration installs metadata Full-Text index when the Full-Text component exists; fallback remains available otherwise | `20261118000400_AddFilesFullTextIndex.cs`, `FilesService.cs` | MIGRATION ADDED / CI RUN REQUIRED |
| A metadata-only scan cannot be approved; bulk approval fails atomically when any pending page lacks an uploaded document | `FileScansService.cs`, `scripts/test-api.ps1` | TEST ADDED / NOT RUN |
| API config returns optional feature flags | `dotnet-api/tests/RecordRoom.Api.Tests/FeatureSwitchTests.cs`, `scripts/test-api.ps1` | TEST ADDED / NOT RUN |
| Non-scope optional flags default off and can be enabled independently | `FeatureSwitchTests.cs` | TEST ADDED / NOT RUN |
| Disabled optional feature filter returns 404; enabled one passes | `FeatureSwitchTests.cs` | TEST ADDED / NOT RUN |
| Access audit action appended without changing existing enum values | `FeatureSwitchTests.cs` | TEST ADDED / NOT RUN |
| Opening a digitisation scan writes an Access audit event | `scripts/test-api.ps1` | TEST ADDED / NOT RUN |
| Opening a file attachment writes an Access audit event | `scripts/test-api.ps1` | TEST ADDED / NOT RUN |
| Approved Front/Back scan images compose into a `FinalPdf` document version, retain both sources, return a two-page PDF and store SHA-256 | `dotnet-api/scripts/test-api.ps1` | TEST ADDED / NOT RUN |
| Plain user input is safely tokenized into bounded SQL Server full-text prefix terms | `dotnet-api/tests/RecordRoom.Api.Tests/FullTextSearchConditionTests.cs` | TEST ADDED / NOT RUN |
| Intake sign-off before reconciliation is rejected | `scripts/test-api.ps1` | TEST ADDED / NOT RUN |
| Legal-size scan page accepted and size retained | `scripts/test-api.ps1` | TEST ADDED / NOT RUN |
| Front and Back sides accepted independently at the same page number; invalid sides rejected; version numbers are independent | `scripts/test-api.ps1`, `record-room-frontend/tests/features-and-rooms.test.ts` | TEST ADDED / NOT RUN |
| E-office-linked file can be found via link filter and reference search | `scripts/test-api.ps1` | TEST ADDED / NOT RUN |
| Multiple outstanding files in one receipt count as multiple due files | `scripts/test-api.ps1` | TEST ADDED / NOT RUN |
| Frontend optional features default off, can be independently enabled, and API config overrides build values | `record-room-frontend/tests/features-and-rooms.test.ts` | TEST ADDED / NOT RUN |
| Frontend four-role capability matrix covers Admin/Supervisor/Operator/Employee grants and denials | `record-room-frontend/tests/permissions.test.ts` | TEST ADDED / NOT RUN |
| Server permission filter returns 401/403 and enforces the role grants including custody and document deletion | `dotnet-api/tests/RecordRoom.Api.Tests/FeatureSwitchTests.cs` | TEST ADDED / NOT RUN |
| Live HTTP harness checks supervisor users.view/users.edit, employee issue denial, operator custody view/manage and direct API role boundaries | `dotnet-api/scripts/test-api.ps1` | TEST ADDED / NOT RUN |

### 9.2 Required tests still missing

| Test group | Required scenarios |
|---|---|
| Permission matrix | Full role/action matrix on live API, direct HTTP calls for read/write/export/document/custody operations, no privilege escalation, disabled account, and regression that server grants match the frontend matrix. Editable permission changes and last-admin lockout remain deferred unless approved. |
| Search | Metadata search, exact file number, department/date filters, OCR body-text search after OCR is added, pagination, permissions, SQL FTS index availability/fallback, Hindi-English matching, query plan and large-volume performance. |
| e-office | Successful transfer, credential failure, timeout, duplicate/retry idempotency, partial failure, provider rejection, receipt/reference persistence, source checksum match. |
| Scanning | A0/A1/A2/A3/A4/Legal; front/back side identity and separate versioning; image and PDF uploads; page order; duplicate/rescan versions; corrupted/unsupported/oversized file rejection. |
| Scan Studio/PDF | Reorder, rotate, replace, insert, delete, preserve original, compose PDF, check page count, alignment/crop, PDF open/render, derivative version; current final-PDF composition only covers approved ordered scans. |
| Quality | Low DPI, blur, blank page, poor contrast, skew, wrong orientation, crop loss; failed page cannot be marked quality-approved without override and reason. |
| OCR | Representative Hindi/English, degraded scans, confidence, text persistence, page offsets, search hit links to exact source page, no cross-user leakage. |
| Custody | Intake manifest vs counted quantity, mismatch, recount, damaged/missing exception, outbound return, signed-off immutability, unauthorized write. |
| Application handover | Freeze a verified release; stage production; reconcile data; complete UAT/security/performance acceptance; prove backup/restore; transfer source, build artefacts, configuration and runbooks securely; train users/IT; sign production and operational takeover; agree warranty and support SLA. |
| Dashboard | Reconcile approved file-count/page-count baselines, placed count, issued files, due file-lines, overdue files and approved PDF page volume against source registers; verify unset-baseline UI messaging. |
| Deployment/storage | SQL migration on clean DB, upgrade from existing v2 DB, private file persistence across deploy, backup/restore, large upload and API restart. |

### 9.3 Execution commands

Run from a clean checkout on a Windows development machine with .NET 10, Node/pnpm and SQL Server configured. Use a dedicated test database, not the production database.

```powershell
# API
cd dotnet-api
dotnet restore
dotnet build --no-restore
dotnet test --no-build

# Start API against a dedicated test SQL Server database in another terminal:
dotnet run --project src/RecordRoom.Api --urls http://localhost:5199

# Real HTTP smoke harness (destructive scenarios unless -SkipDestructive is specified)
.\scripts\test-api.ps1 -BaseUrl http://localhost:5199

# Frontend
cd ..\record-room-frontend
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

# Live HTTP contract test must target the running local test API:
pnpm vitest run tests/api-contract.test.ts
```

**Do not record a green test result unless command output and target database are known.** GitHub source commits do not prove a local build or live SQL test ran.

## 10. Implementation sequence and gates

| Priority | Work package | Scope | Exit gate |
|---:|---|---|---|
| P0 | Final scope tracker and retained-feature hiding | This document; switches, API guards, UI navigation/route guards | New branch; tests green; disabled modules inaccessible by URL and API. |
| P0 | Core workflow audit | Four roles, metadata, issue/return, uploads, scan review, custody, dashboard | Live API and frontend checks green; role/action matrix agreed. |
| P0 | Server capability permissions | Static four-role matrix is enforced by `RequirePermission` across the reviewed controllers; direct-call HTTP tests cover representative allowed/denied actions. | Full role/action matrix passes against live SQL Server; editable DB-driven management is optional unless the Department explicitly requires it. |
| P1 | Custody manifest and scanning evidence | Front/back page-side identity is implemented; add item-level receipt manifest, scanner DPI/color/orientation and physical exceptions. | Page manifest reconciles with intake file count and page-side counts. |
| P1 | Department application handover | Prepare the final software release, source/build/database/configuration package, deployment and rollback runbook, backup/restore evidence, security/admin guide, user guides, training, UAT defect closure and support transition. | Department-signed UAT, production go-live and operational takeover; source and access transfer recorded. |
| P1 | e-office integration | External transfer, acknowledgement and retries | Interface access/approval supplied; successful and failure-path integration tests. |
| P1 | Complete metadata search acceptance | Confirm metadata dictionary/date fields, SQL FTS active on target SQL Server, relevance and 25-lakh-row performance | Search acceptance on agreed dataset and query performance. |
| P2 | OCR POC and production pipeline | On-prem OCR, representative sample, searchable text | Department-approved POC and OCR accuracy threshold. |
| P1 | Complete Scan Studio and PDF acceptance | Current API composes approved page sides to a private versioned final PDF; add reorder/rotate/replace/insert/delete and quality-aware output verification | End-to-end sample PDF accepted by the Department. |
| P2 | Image quality gates | DPI, skew, contrast, blur, blank-page, crop and orientation checks | Measured criteria approved; failed images require correction/rescan. |
| P2 | Archival output and PDF/A validation | PDF/A level, validation and metadata | PDF/A level confirmed and validator passes approved sample. |
| P3 | Deployment and operational acceptance | SQL Server migration, persistent storage, backups, TLS, observability, load test | Department/IT operations sign off production readiness. |

## 11. Open Department inputs (blocking items)

Do not guess these values or silently choose vendors/standards.

- [ ] Nodal officer and departmental representatives.
- [ ] Final physical file count and page/page-side count.
- [ ] Document size distribution by A4/Legal/A3/A2/A1/A0.
- [ ] File identification and duplicate rules.
- [ ] Approved metadata dictionary, including date and classification fields.
- [ ] Expected total page volume for dashboard denominator.
- [ ] Quality acceptance thresholds, including DPI, alignment, crop, contrast and legibility.
- [ ] Pilot sample batch and formal pilot approval.
- [ ] e-office interface specification, credentials, network path, test environment and integration approval.
- [ ] Required final PDF and archival/PDF-A level.
- [ ] Approved application handover checklist, production environment, backup/restore responsibility, training plan, support SLA and sign-off format.
- [ ] Department review period and correction/acceptance process.
- [ ] Special-handling list and out-of-scope change-control process.
- [ ] Server, storage, backup, network, workspace and scanning infrastructure responsibility matrix.

## 12. Operating rule for future work

1. Work only on `zila_codex` unless the user explicitly changes the target branch.
2. Preserve existing v1 and optional modules; hide non-scope functions instead of deleting their code.
3. No unrelated new feature work. Implement only the final proposal, its necessary operational controls, and tests.
4. Every requirement change must update this tracker, tests and API/web documentation in the same PR.
5. Keep physical service-provider activities separate from app functionality, while capturing digital evidence when the Department requires it.
6. Never mark e-office, OCR, PDF generation, quality gates, FTS or Department application handover complete until their explicit acceptance conditions pass.
