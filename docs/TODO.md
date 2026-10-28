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
- [ ] Add `.gitattributes` (`* text=auto eol=lf`) + `git add --renormalize .` **(P — await approval; baseline commit already emitted ~130 LF→CRLF warnings, proof of the defect)** → §2.1 #5
- [x] Decide on lost git history — no original clone available; baseline `301d74d` is canonical
- [x] Prune plan references to files that no longer exist (legacy PHP app, Word proposal, old hashes) — §1 note added
- [ ] Question still open for the README/AGENTS/deploy scripts: they still plan for `jhs_digitization-og-php-app/`, which is not on disk (reference-only docs, no code depends on it). Prune or keep as provenance **(P)**

## 1. In flight right now (§1.2)

- [ ] One clean full `pnpm test` since the baseline — run after ≥110 s of API idle (10-logins/60s budget)
- [ ] Write `scripts/barcode-gun.ahk` AutoHotkey simulator; then verify `IssuePage` handles rapid consecutive scans (no `onKeyDown` exists anywhere — every scan path depends on Enter reaching a form submit) **(deferred by choice)** → §2.1 #2 + v1 DoD
- [ ] `docs/skills/` reorganisation — user-owned; already captured in baseline, do not consolidate into someone else's commit

---

## 2. v1 — defects (§2.1)

- [ ] **D1 — Sargable search.** Kill `ToLower().Contains()` in all **three** places: `FilesService.cs:93-104` (registry), `DigitizationService.cs:86-93` (batch needle), `IssuesService.cs:62-73` (borrower); add index over the effective columns
  - [ ] Done when: SQL Server's plan for registry search no longer scans
- [ ] **D2 — Scan auto-submit.** Detect a fast keystroke burst → submit + refocus (also unblocks the gun simulator and E1)
  - [ ] Done when: gun-style rapid input issues a file on the issue desk, mouse untouched
- [ ] **D3 — `/` shortcut.** Topbar advertises it (line 97-99); no handler exists. Implement (focus record search) or delete the hint
  - [ ] Done when: pressing `/` moves focus to search
- [ ] **D4 — Test-suite rate-limit fragility.** `test-api.ps1` has no 429/retry/abort handling; make the first sign-in failure abort the suite instead of 401-cascading
  - [ ] Done when: a throttled login fails one assertion, not nineteen
- [ ] **D5 — `.gitattributes`** (see §0 above) **(P)**
  - [ ] Done when: `pnpm format:check` passes on a fresh checkout
- [ ] **D6 — In-app PDF reader** → §3 below

## 3. v1 — PDF reader (§2.2)

- [ ] 3.1 Add `react-pdf` 11.0.0 + `pdfjs-dist` 6.4.299 (verify versions against npm at implementation time)
- [ ] 3.2 `.npmrc`: add `public-hoist-pattern[]=pdfjs-dist` alongside `auto-install-peers` / `prefer-frozen-lockfile`
- [ ] 3.3 Wire worker + `cMaps` + `standard_fonts` per react-pdf's Vite guidance, in the module that renders `<Document>`
- [ ] 3.4 Build the viewer: page nav, jump-to-page, zoom in/out/fit-width, rotate, in-document text search, download
- [ ] 3.5 Replace **both** iframe sites: `DocumentUploadActions.tsx:232` and `components/files/DocumentViewer.tsx:174` (used by `FileViewerPage`)
- [ ] 3.6 Keep the `#page=` deep link working from registry rows
  - [ ] Done when: reader replaces every iframe, in all three themes

## 4. v1 — UI enhancements (§2.3)

- [ ] **E1** Scan auto-advance on Enter (same work as D2)
- [ ] **E2** Focus trap + scroll lock in `Modal` (aria-modal alone does not trap — `Modal.tsx:50`); focus return in `CommandPalette`
- [ ] **E3** Skeleton loaders shaped like each table, replacing the spinner
- [ ] **E4** Bulk selection + bulk actions on the registry table (relocate, assign shelf, export)
- [ ] **E5** Registry table sticky header + column show/hide
- [ ] **E6** One consistent flash/toast location
- [ ] **E7** Responsive audit below 768px: registry, issue desk, location designer
- [ ] **E8** Command palette: recent files, recent searches, per-result match context

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
