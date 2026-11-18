# Zila Panchayat DMS — final-scope implementation tracker

**Scope authority:** the final proposal supplied in this conversation (sections 1.1–1.4). Where older plans, README files, UI labels, or implementation notes conflict with that proposal, this document takes precedence.

**Working branch:** `zila_codex`  
**Branch base:** current `v2` HEAD at branch creation  
**Review date:** 18 November 2026  
**Production target:** SQL Server-backed web application  
**Tracking rule:** every subsequent implementation PR/commit must update the status, evidence, tests and open acceptance criteria in this file.

> **Current overall status: PARTIAL — not yet proposal-complete.** The core DMS register, four-role authentication, issue/return, in-app document storage, digitisation review and custody register exist. Important contractual capabilities are still missing, especially e-office transfer, OCR/full-text search, scan composition and final PDF generation, technical image-quality gates, page-side tracking, fully server-enforced capability permissions, and a formal digital-deliverables handover workflow. Do not describe these as complete until the acceptance conditions below pass.

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
| Intake reconciliation before sign-off | DONE / TEST NOT RUN | An inbound custody event cannot be signed off until a reconciliation count exists. |
| Legal document-size option | DONE / TEST NOT RUN | Legal added alongside A0/A1/A2/A3/A4/Other in the file and scan size validation/UI. |
| Dashboard metric corrections | PARTIAL / TEST ADDED | Mapped percentage counts files with a shelf placement; due counts count outstanding file-lines, not receipts; digitisation percentage counts approved PDF pages against an agreed expected-page baseline. The denominator remains to be finalized and configured. |
| Automated and live verification | PENDING | The GitHub source changes were committed through repository access. A clean local checkout, .NET build/test, pnpm checks, live SQL Server API harness and API-contract test have not yet been observed as passing on this branch. |

## 3. Final proposal 1.1 — DMS software

| # | Requirement | Existing implementation / evidence | State | Remaining work and acceptance condition |
|---|---|---|---|---|
| 1.1.1 | Web login for authorized users | ASP.NET authentication and React session flow. Four role names exist: Admin, Supervisor, Operator and Employee. | DONE | Run the full role login and access test matrix on SQL Server. Verify inactive account, failed password and logout behavior. |
| 1.1.2 | Capability matrix for each role | Frontend capability map and API role-based `[Authorize(Roles=...)]` restrictions exist. The database-backed editable permission matrix is only designed; role-name attributes remain the main API authorization boundary. | PARTIAL | Implement central server-side permission policies for every read/write/export/document endpoint. UI hiding is not security. Test each role against each permission, including direct HTTP requests and escalation attempts. |
| 1.1.3 | Audit stamps | Write services use `IAuditWriter`; entries contain actor, role, timestamp, IP, before/after values and summary. Document view events were added in this branch. | PARTIAL | Add/verify audit events for every document read, download, export, upload, deletion, metadata change, permission change and handover. Confirm retention and immutability policy; prove no ordinary user can alter/delete audit rows. |
| 1.1.4 | Login history | Success/failure/sign-out history, login channel, IP/client and Admin/Supervisor audit view exist. | DONE | Re-run positive, negative, deactivated-user, OTP/PIN and sign-out tests. Confirm user-facing privacy policy for stored IP/client data. |
| 1.1.5 | Account controls | Admin user create/update/deactivate/delete and role assignment exist. | DONE | Verify password reset, account lock/deactivation, last-admin safety and all four role cases. |
| 1.1.6 | Dashboard — registry size | Registry total is currently represented by the legacy collection baseline (2,478,450). | PARTIAL | Department must reconcile this with the physical inventory and agreed final volume. Replace/configure the value based on the signed inventory, not a hard-coded assumption. |
| 1.1.7 | Dashboard — percentage of files mapped | This branch defines mapped as a file assigned to a physical shelf and counts files with `ShelfId != null`. | PARTIAL | Department must confirm that “mapped” means physical shelf placement (not a map drawing or scanned map). Validate against a sample signed by the nodal officer. |
| 1.1.8 | Dashboard — files issued | Counts files currently in Issued status. | DONE | Verify it reconciles with all open issue receipt lines on live data. |
| 1.1.9 | Dashboard — files due | Counts each unreturned file-line whose receipt due date is within the dashboard due window. A 5-file receipt contributes 5 due files, not 1. | DONE / TEST ADDED | Run the smoke test which creates one receipt with multiple due files and verifies the line count. Confirm the department's due-day boundary (today only vs overdue plus today). |
| 1.1.10 | Dashboard — digitization percentage | This branch calculates approved scan pages divided by `Scope:ExpectedPageCount`, capped at 100%. | PARTIAL / BLOCKED | Department must finalize the expected total page volume. Set `Scope__ExpectedPageCount` in the API environment. Until then, dashboard intentionally reports 0% instead of manufacturing a denominator. |
| 1.1.11 | Issue and return | Multi-file receipt, partial returns, borrower list/ledger, due dates and overdue status/job exist. | DONE | Run issue/partial-return/final-return/overdue tests under concurrent requests and ensure file and receipt states remain consistent. |
| 1.1.12 | Upload digitized documents to e-office | App-side private document storage, versioning, SHA-256 and content view/download exist. File metadata includes optional e-office reference, searchable/filterable in the registry. There is no real e-office transfer/API integration yet. | PARTIAL / BLOCKED | Department to supply interface specs, endpoint/network access, authentication, file-size/type rules, acknowledgement ID, retry policy, and test environment. Then implement real upload, transfer state, idempotency and reconciliation. An e-office reference field alone is not an upload. |
| 1.1.13 | Retain reference copy in this application | Private versioned file storage retains the original upload with content metadata/hash. | DONE for in-app copy | Verify backup/restore, storage encryption, access policy, retention, and consistency between SQL metadata and blob storage. |
| 1.1.14 | Provide/configure/integrate digitized files into the DMS | Registry metadata, file-level document attachments, scan pages and content endpoints exist. | PARTIAL | Complete the scan-to-document workflow, generated PDF, metadata links, review approval and secure in-app reader. Confirm production storage location, maximum volume, backup and migration procedures. |
| 1.1.15 | Search digitized data | Registry search currently covers indexed metadata such as file number, subject, department, location, holder and e-office reference. | PARTIAL | Add SQL Server full-text search over approved metadata fields, relevance ranking, pagination, filters and query plans suitable for 25-lakh-scale registry. |
| 1.1.16 | Search OCR text of digitized documents | OCR text extraction and indexing are not implemented. Existing search does not search PDF/image contents. | PENDING / BLOCKED | Complete OCR engine POC on approximately 100 representative departmental scans (including faded/stamped/carbon-copy records), get approval, persist OCR text with page/source references, and include it in permission-filtered full-text search. No cloud OCR without written government approval. |
| 1.1.17 | Audit access/change/upload and timestamps | Change/upload writes are audited; file, scan and map content opening now writes `Access`. | PARTIAL / TEST ADDED | Verify every read path, report/export, image preview, download and bulk operation. Access audit must identify actor, document ID/version, action and timestamp. |

## 4. Final proposal 1.2 — physical record organization and digitization

| # | Requirement | Existing implementation / evidence | State | Remaining work and acceptance condition |
|---|---|---|---|---|
| 1.2.1 | Receive physical files from department | Custody register stores inbound/intake events, department, file count, batch reference, recorder and remarks. | PARTIAL | Add an item-level receipt manifest (file number or temporary tag per physical file), condition/exception notes and receipt acknowledgement. Reconcile manifest count with aggregate count. |
| 1.2.2 | Count files and secure handover | Custody reconciliation stores a counted number; this branch requires reconciliation before intake sign-off. | PARTIAL / TEST ADDED | Test mismatch handling, recounts, damaged/missing records, immutable handover signature/time and department representative identity. |
| 1.2.3 | Prepare documents for scanning (unbinding, remove staples/pins, dust, flatten creases) | Physical work is not performed by the application. No verified digital preparation checklist was found. | EXTERNAL / PARTIAL | Service Provider must perform physical preparation. Add a batch checklist/evidence record only if the department requests software evidence for each preparation step. |
| 1.2.4 | Scan A4/Legal, A3 and A0/A1/A2 per page per side | File/scan size options include A0/A1/A2/A3/A4/Legal/Other. This branch adds explicit Front/Back identity to each page row, a backward-compatible SQL migration, and page-side-specific versioning/uniqueness. | PARTIAL | Add scanner DPI/color mode/orientation metadata and verify actual per-side capture from the scanners. Confirm actual A0/A1/A2 scanner capability and supported file-size limits with operator equipment. |
| 1.2.5 | PDF output that is legible, aligned and cropped | App can upload and retain PDF files and review individual scan uploads. It does not yet compose an image gallery into a final ordered PDF or enforce legibility/crop/deskew. | PARTIAL | Implement Scan Studio: image gallery, reorder/rotate/replace/insert/remove, preservation of originals, preview, PDF composition, output verification and versioning. |
| 1.2.6 | Quality verification, correction or rescanning | Scan review queue supports Pending/Approved/Rejected, rejection reason, rescan versioning and file-level review-all. | PARTIAL | Add measurable image-quality gates (minimum DPI, blur/contrast/blank-page/rotation/deskew/crop checks), per-page issue flags and rescanning workflow. Supervisor review must not replace technical acceptance checks. |
| 1.2.7 | Metadata creation/indexing (file number, date, subject, department) | Registry stores file number, subject, department and year; related fields can be searched. No explicit document date field or department-approved configurable schema was confirmed. | PARTIAL | Agree metadata dictionary with Department, add document/date fields where required, validation, mandatory-field rules, bulk reconciliation and full-text index integration. |
| 1.2.8 | Upload to e-office; retain reference copy in app | App-side copy/versioning and e-office reference text field exist; external transfer does not. | PARTIAL / BLOCKED | Implement only after written interface specification and credentials/test access. Keep transfer state and e-office receipt/reference tied to immutable app copy/hash. |
| 1.2.9 | Digital deliverables and supporting data handover in approved format | Custody outbound/return sign-off exists for physical records. No generated digital delivery package, checksum manifest, metadata export package or digital acceptance/sign-off workflow was found. | PENDING | Build digital handover batches with files/PDFs, metadata CSV/JSON, checksum manifest, exceptions, package version, delivered-by/received-by, timestamps and department acceptance/rejection. |
| 1.2.10 | Department sign-off on digital handover | Physical return custody sign-off exists, but it is not a digital delivery sign-off. | PENDING | Implement separate digital-deliverables sign-off and prevent a batch from becoming accepted/closed until all agreed deliverables and exceptions are acknowledged. |

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
| 1.3.9 | Approve pilot, quality, reports and final handover arrangements | BLOCKED | Signed pilot acceptance, DPI/quality thresholds, sample PDF, reports, delivery format and sign-off form. |

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
| Data handover | PENDING | Approved package structure, metadata format, checksum requirement, media and sign-off form. |
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
| Server-side permissions | PARTIAL | Replace coarse role attributes with permission policy enforcement; add positive and negative endpoint tests. |
| File/document access | PARTIAL | Check authorization before content stream; audit view/download; no public blob URLs. |
| Audit integrity | PARTIAL | Protect audit data against user update/delete; verify all CRUD, access and export actions. |
| SQL Server data integrity | PARTIAL | Verify migrations, unique constraints, transaction handling and concurrency for issue/return, file upload/version and custody/handover. |
| Private storage | PARTIAL | Verify encryption, file type/size validation, malware scanning, backup/restore and DB/blob consistency. |
| Search scale | PENDING | SQL Server FTS, query-plan review and realistic load test against agreed volume. |
| OCR | PENDING | POC on real representative scans, on-prem deployment and permission-filtered indexing. |
| PDF generation | PENDING | Ordered scan pages to PDF with page count, render validation and versioned derivative. |
| Image quality | PENDING | DPI, skew, contrast, blur, blank-page, crop and orientation checks. |
| e-office | BLOCKED | Integration only after approved interface details. |
| Digital handover | PENDING | Package manifest, checksums, immutable handover record and acceptance sign-off. |
| Deployment | PARTIAL | Validate environment defaults, SQL Server connection, persistent documents directory, TLS, backup and restore on target server. |

## 9. Test plan and missing-feature regression matrix

### 9.1 Tests already present or added in this branch

| Test | Location | Status |
|---|---|---|
| API config returns optional feature flags | `dotnet-api/tests/RecordRoom.Api.Tests/FeatureSwitchTests.cs`, `scripts/test-api.ps1` | TEST ADDED / NOT RUN |
| Non-scope optional flags default off and can be enabled independently | `FeatureSwitchTests.cs` | TEST ADDED / NOT RUN |
| Disabled optional feature filter returns 404; enabled one passes | `FeatureSwitchTests.cs` | TEST ADDED / NOT RUN |
| Access audit action appended without changing existing enum values | `FeatureSwitchTests.cs` | TEST ADDED / NOT RUN |
| Opening a digitisation scan writes an Access audit event | `scripts/test-api.ps1` | TEST ADDED / NOT RUN |
| Opening a file attachment writes an Access audit event | `scripts/test-api.ps1` | TEST ADDED / NOT RUN |
| Intake sign-off before reconciliation is rejected | `scripts/test-api.ps1` | TEST ADDED / NOT RUN |
| Legal-size scan page accepted and size retained | `scripts/test-api.ps1` | TEST ADDED / NOT RUN |\n| Front and Back sides accepted independently at the same page number; invalid sides rejected; version numbers are independent | `scripts/test-api.ps1`, `record-room-frontend/tests/features-and-rooms.test.ts` | TEST ADDED / NOT RUN |
| E-office-linked file can be found via link filter and reference search | `scripts/test-api.ps1` | TEST ADDED / NOT RUN |
| Multiple outstanding files in one receipt count as multiple due files | `scripts/test-api.ps1` | TEST ADDED / NOT RUN |
| Frontend optional features default off, can be independently enabled, and API config overrides build values | `record-room-frontend/tests/features-and-rooms.test.ts` | TEST ADDED / NOT RUN |

### 9.2 Required tests still missing

| Test group | Required scenarios |
|---|---|
| Permission matrix | For every endpoint/action, Admin/Supervisor/Operator/Employee allowed and denied matrix; direct HTTP calls; file read/download/export; no role escalation; disabled account; no self-lockout. |
| Search | Metadata search, exact file number, department/date filters, OCR body-text search after OCR is added, pagination, permissions, SQL FTS query plan and large-volume performance. |
| e-office | Successful transfer, credential failure, timeout, duplicate/retry idempotency, partial failure, provider rejection, receipt/reference persistence, source checksum match. |
| Scanning | A0/A1/A2/A3/A4/Legal; front/back side identity and separate versioning; image and PDF uploads; page order; duplicate/rescan versions; corrupted/unsupported/oversized file rejection. |
| Scan Studio/PDF | Reorder, rotate, replace, insert, delete, preserve original, compose PDF, check page count, alignment/crop, PDF open/render, derivative version. |
| Quality | Low DPI, blur, blank page, poor contrast, skew, wrong orientation, crop loss; failed page cannot be marked quality-approved without override and reason. |
| OCR | Representative Hindi/English, degraded scans, confidence, text persistence, page offsets, search hit links to exact source page, no cross-user leakage. |
| Custody | Intake manifest vs counted quantity, mismatch, recount, damaged/missing exception, outbound return, signed-off immutability, unauthorized write. |
| Digital handover | Generate package, verify hashes, export metadata, deliver/retry, receiver reject/accept, signer/time, package version and final closure. |
| Dashboard | Reconcile total registry, placed count, issued files, due file-lines, overdue files, approved page volume and expected-page denominator against source registers. |
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
| P1 | Server capability permissions | DB-backed role-permission and policy enforcement | All endpoints verified; no direct-call bypass. |
| P1 | Scan page-side and manifest | Front/back side, unique page-side identity, batch item manifest and physical exceptions | Page manifest reconciles with intake file count and page-side counts. |
| P1 | Digital handover | Delivery batches, metadata export, checksums and department sign-off | Signed end-to-end acceptance on a sample batch. |
| P1 | e-office integration | External transfer, acknowledgement and retries | Interface access/approval supplied; successful and failure-path integration tests. |
| P1 | Metadata search + SQL FTS | Approved metadata and scale-ready indexing | Search acceptance on agreed dataset and query performance. |
| P2 | OCR POC and production pipeline | On-prem OCR, representative sample, searchable text | Department-approved POC and OCR accuracy threshold. |
| P2 | Scan Studio and PDF composition | Image gallery, page operations, original preservation, PDF output | End-to-end sample PDF accepted. |
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
- [ ] Approved metadata and handover package format.
- [ ] Department review period and correction/acceptance process.
- [ ] Special-handling list and out-of-scope change-control process.
- [ ] Server, storage, backup, network, workspace and scanning infrastructure responsibility matrix.

## 12. Operating rule for future work

1. Work only on `zila_codex` unless the user explicitly changes the target branch.
2. Preserve existing v1 and optional modules; hide non-scope functions instead of deleting their code.
3. No unrelated new feature work. Implement only the final proposal, its necessary operational controls, and tests.
4. Every requirement change must update this tracker, tests and API/web documentation in the same PR.
5. Keep physical service-provider activities separate from app functionality, while capturing digital evidence when the Department requires it.
6. Never mark e-office, OCR, PDF generation, quality gates, FTS or digital handover complete until their explicit acceptance conditions pass.
