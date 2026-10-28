# Record Room — TODO tracker

The day-to-day checklist. Each item references its section in
[`WORK-PLAN.md`](WORK-PLAN.md) (same directory) — the plan carries the "why"
and the done-definitions; this file carries the "is it done yet".

- Snapshot: **2026-10-28**
- Repo baseline: `301d74d` — *baseline snapshot: unify recordroom workspace
  (no prior history)*. Hashes below that look like `301d74d` resolve; anything
  in the plan's §1 old-history table does **not**.
- Conventions: `[x]` done · `[ ]` open · **(P)** blocked on a user decision ·
  **(G)** hard gate that can stop sequencing.

---

## 0. Repo / housekeeping

- [x] `git init -b main` + baseline commit of the full working tree — `301d74d`
- [x] Add `.gitattributes` (`* text=auto eol=lf`) + `git add --renormalize .` — approved 2026-10-28, done `3b0de66`
- [x] Decide on lost git history — no original clone available; baseline `301d74d` is canonical
- [x] Prune plan references to files that no longer exist (legacy PHP app, Word proposal, old hashes) — §1 note added
- [ ] Question still open for the README/AGENTS/deploy scripts: they still plan for `jhs_digitization-og-php-app/`, which is not on disk (reference-only docs, no code depends on it). Prune or keep as provenance **(P)**
- [x] Restore the lost "no Redis must not 500" fix — the plan's `30da20a` did not survive into this tree; `GetService` degradation restored in `e1dd88d`, health endpoint verified green with `redis:false`

## 1. In flight right now (§1.2)

- [x] One clean full `pnpm test` since the baseline — **141/141 against the live API** (19 contract assertions) on 2026-10-28; `test-api.ps1` 157/157 after the idempotency fix
- [x] Tests no longer inherit the developer's `.env.local` — standalone `vitest.config.ts` pins `VITE_API_MODE=local` (a `http` mode in `.env.local` had flipped 53 node-env tests onto the API, where the http reset path needs `window`)
- [ ] Write `scripts/barcode-gun.ahk` AutoHotkey simulator; then verify `IssuePage` handles rapid consecutive scans (no `onKeyDown` exists anywhere — every scan path depends on Enter reaching a form submit) **(deferred by choice)** → §2.1 #2 + v1 DoD
- [ ] `docs/skills/` reorganisation — user-owned; already captured in baseline, do not consolidate into someone else's commit

---

## 2. v1 — defects (§2.1)

- [x] **D1 — Sargable search.** Kill `ToLower().Contains()` in all **three** places: `FilesService.cs:93-104` (registry), `DigitizationService.cs:86-93` (batch needle), `IssuesService.cs:62-73` (borrower); add index over the effective columns — **done `34a777a`**: identity columns (barcode, file number, e-office ref, batch/receipt codes) match as prefixes (seekable), free text stays substring until FTS (v2 6.2); `IX_Files_FileNumber` + `IX_Files_EOfficeReference` added, migration `20261028000000_AddFileSearchIndexes` applied on the local dev DB
  - [x] Note: mid-string search on identity columns no longer matches — deliberate trade, restored by full-text index in v2
- [x] **D2 — Scan auto-submit.** Fast keystroke burst → submit + refocus; `src/hooks/useScanAutoSubmit.ts` wired into the issue-desk scan input (`90c7b05`); human typing/paste deliberately not auto-submitted
  - [ ] Verified with the actual gun simulator — pending the simulator below
- [x] **D3 — `/` shortcut.** Already implemented at `Topbar.tsx:28-40` (window keydown, not the React prop — earlier grep missed it); plan claim was stale. No code needed
- [x] **D4 — Test-suite rate-limit fragility.** `Get-Token` in `test-api.ps1` aborts the suite with a rate-limit explanation on a failed sign-in; trap prints a readable verdict (`9839fa5`)
- [x] **D5 — `.gitattributes`** approved and done: `* text=auto eol=lf`, `.bat` keeps CRLF, binaries excluded; committed `3b0de66`
- [x] **D6 — In-app PDF reader** → §3 below

## 3. v1 — PDF reader (§2.2)

- [x] 3.1 `react-pdf` 11.0.0 + `pdfjs-dist` 6.4.299 (both verified against npm; pnpm override forces one shared copy so the worker and main thread agree on the version)
- [x] 3.2 `.npmrc`: `public-hoist-pattern[]=pdfjs-dist` added
- [x] 3.3 Worker + `cMaps` + `standard_fonts` + `wasm` wired per the react-pdf Vite recipe (`vite-plugin-static-copy` added; worker set in the module that renders `<Document>`) — build copies 201 assets
- [x] 3.4 Viewer: page nav, jump-to-page, zoom in/out/fit-width, rotate, in-document text search (jumps to matching page + highlights on-page), download kept in the parents
- [x] 3.5 **Both** iframe sites replaced: `DocumentUploadActions.tsx` and `components/files/DocumentViewer.tsx` (used by `FileViewerPage`); reader is a lazy ~650 kB chunk loaded only when a PDF is opened (`307b529`)
- [x] 3.6 Deep link: `pageIndex` flows into the reader as the initial page (the object-URL `#page=` fragment is only still used by "Open in new tab")
  - [x] Done when: **verified live 2026-10-28** — renders the uploaded 3-page PDF, page nav / jump (with out-of-range clamping) / zoom / rotate / search ("Estimate" → jumps to page 2, highlights both matches, "Found on page 2" status) all work
  - [x] User feedback: highlight was opaque accent blue and hid the text under it → restyled `.pdf-search-mark` to translucent yellow (rgb(250 204 21 / 45%), glyphs stay transparent so the canvas text shows through)

## 3a. User-reported on the live demo (2026-10-28)

- [x] **Search highlight opaque** — see §3 above
- [x] **No admin delete for a stored scan version** — full contract-seam change: `files.deleteDocument` in `contracts.ts`, HTTP adapter, in-memory adapter, API `DELETE /api/files/{fileId}/documents/{documentId}` (`[Authorize(Roles = "Admin")]`), trash button on each Scan-versions row (confirm dialog), audit + realtime announce; harness section "File scan versions (upload + admin delete)" asserts employee/operator/supervisor 403 and admin 200; verified live (delete + audit entry) and visually
- [x] **Physical placement must be optional on file create** — done 2026-10-28/29, verified live (create RF-0005952914 with no shelf → "Not placed"; issue + return roundtrip; then "Place this file on a shelf" from the file page → full location path, position, shelf barcode)
  - API: `FileCreateInput.ShelfId` is `int?`; `ValidateCreateAsync` only validates an explicitly chosen shelf; `CreateAsync` is one path with nullable room/section/almirah/shelf, `LocationDisplay = "Not placed"`, occupancy bump + movement/audit/announce conditional
  - Frontend: create form placement is optional ("Not placed yet" defaults, hints); http adapter sends `shelfId: null` when empty; in-memory adapter mirrors the same guards; file page shows a "Not placed" location card and the relocate card becomes "Place this file on a shelf"
  - Harness: new "Optional placement" section — unplaced create, issuable-while-unplaced roundtrip, shelved-later via relocate (174/174)
- [ ] **Digitization is not a separate file kind** — decision (2026-10-28): **file-centric only, batches removed**
  - Every file gets "Add scan": upload a full PDF, or add page-by-page scans (page no + A1/A4/…/map options) straight on the file, with per-page review
  - The employee/folder batch concept is deleted; the Digitization section becomes a pending-review queue across files, not a batch list
  - Same schema options as the file: documentSize (A1/A4/…) and recordKind (File/Map) on scans
- [x] **`/rooms/1` shows "Room not found"** — fixed: `RoomDetailPage` read the local `useDb()` snapshot, which is empty under the HTTP adapter; it now loads `service.locations.room(id)` + `service.files.list({ roomId })` via `useQuery`. Verified live at `/rooms/1`

## 4. v1 — UI enhancements (§2.3)

- [x] **E1** Scan auto-advance on Enter (shipped with D2)
- [x] **E2** Focus trap + scroll lock in `Modal`, focus return on close (`e5d9d09`). Correction: **no CommandPalette exists in this tree** — the "focus return in CommandPalette" half is void until E8 builds one
- [ ] **E3** Skeleton loaders shaped like each table, replacing the spinner
- [ ] **E4** Bulk selection + bulk actions on the registry table (relocate, assign shelf, export)
- [ ] **E5** Registry table sticky header + column show/hide
- [ ] **E6** One consistent flash/toast location
- [ ] **E7** Responsive audit below 768px: registry, issue desk, location designer
- [ ] **E8** Command palette: recent files, recent searches, per-result match context — **re-scope: build it, it does not exist**

## 5. v1 — definition of done

- [ ] All API checks and Web checks green on a clean checkout (including `format:check`)
- [ ] Full `pnpm test` clean **including** `tests/api-contract.test.ts` against a live API
- [ ] PIN/password/OTP states verified in the browser
- [ ] PDF reader live everywhere the iframe is, in all three themes
- [ ] `scripts/barcode-gun.ahk` written and issue-desk rapid-scan behaviour verified

---

## 6. v2 — pipeline (§3)

- [ ] **6.1 — Sargable registry query + index** if D1 didn't already land it (§3.1)
- [ ] **6.2 — SQL Server full-text index** over existing metadata columns; registry search box becomes its frontend surface (§3.1)
- [ ] **6.3 — Image quality gates** — OpenCvSharp5 5.0.0.20261012 (+ linux-x64 runtime): deskew (median, `minAreaRect`), despeckle, binarise + component removal, quad crop, CLAHE, rotate; **DPI gate ≥ 200 at upload** with field-level `ApiResponse` error; original scan always preserved (§3.2)
- [ ] **6.4 — OCR POC on ~100 real district records** **(G hard gate) (P — user supplies the records)**: `PaddleOcrNet` 2.4.0 vs `PaddleOCR` 26.9.x, fallback `Tesseract` 5.2.0; no cloud OCR, ever (§3.3)
- [ ] **6.5 — OCR pipeline** — Hangfire job modelled on `mark-overdue-receipts`; models outside web root, warmed per process, pinned model version per page (§3.3)
- [ ] **6.6 — Scan composition studio** — thumbnail gallery, dnd-kit reorder, replace/insert/delete/duplicate/rotate per page, original-vs-processed compare; entities `ScanPageAssets` + `DocumentDerivatives` (§3.4)
- [ ] **6.7 — PDF generation** — QuestPDF 2026.9.1, ordered page images, invisible OCR text layer, header/footer, page numbers (§3.5) **(P — licence check)**
- [ ] **6.8 — PDF/A** — generation at 2b via QuestPDF + in-process validation via `VellumPdf.Conformance` 2.3.3, veraPDF as CI ground truth; Ghostscript never for archival; `Codeuctivity.PdfAValidator` is AGPL — never adopt **(P — confirm contract's PDF/A level; QuestPDF cannot emit PDF/A-1)** (§3.6)
- [ ] **6.9 — Custody chain** — `DigitizationCustodyEvent` both directions (intake count reconciliation + return sign-off) via `IAuditWriter` (§3.8)
- [ ] **6.10 — Permission matrix** — per `V2-EDITABLE-PERMISSIONS.md`: `role_permission` table, permission policies replacing `[Authorize(Roles=...)]`, admin self-lockout guard; enforcement swap is its own reviewed commit (§3.7)
- [ ] **6.11 — Infra hardening** — Redis persisted cache; Hangfire on SQL Server storage; HTTPS via domain; CI that boots SQL Server and runs `test-api.ps1` + the contract suite; barcode-gun as a CI flow (§3.9)
- [ ] **6.12 — OpenSearch** — only if 6.6-era relevance demands it; avoid Elasticsearch (SSPL) and `Lucene.Net` (§3.1)

---

## 7. Waiting on the user (§5)

- [ ] Approve `.gitattributes` + renormalisation → D5
- [ ] Supply ~100 real records for the OCR POC → 6.4 hard gate
- [ ] Confirm which PDF/A level the contract names → 6.7 / 6.8
- [ ] Confirm QuestPDF licence eligibility (community licence revenue threshold) → 6.7
- [ ] Decide barcode-gun simulator priority → in-flight item + v1 DoD
- [ ] Confirm which SQL Server instance before touching the API (ssh-tunnel prod-DB hazard is in the README) → every destructive API test run
