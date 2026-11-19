# Record Room — final scope (v2 outstanding work)

Snapshot: 2026-11-19 (docs reorganised; see `docs/OVERVIEW.md` for the product
overview). This file is the **single home of the outstanding v2 scope**: what
remains to finish, in priority order, plus what is still waiting on the user.
V1 is the shipped build — trackers: `docs/TODO.md`, `docs/QA.md`.

Sources folded in: `docs/WORK-PLAN.md`, root `TEMP-TODO.md` (moved to
`docs/ignore/`), `docs/V2-EDITABLE-PERMISSIONS.md` design (moved to
`docs/ignore/` — superseded; its core design is the §1, item 3 rollout
summary),
`docs/Recordroom-features.md` (Parts 2–4, library shortlist),
`docs/IMPLEMENTATION-TODO.md` Stage 8 (moved to `docs/ignore/` — the deferred
backend plan is subsumed by §1), `docs/TODO-DMS-RECORDROOM.md` (phases 1–2
done).

Legend: `[x]` done · `[ ]` open · **(P)** blocked on a user decision ·
**(G)** hard gate that can stop sequencing.

---

## 1. Outstanding v2 work — sequence and gates

Sequence follows `docs/Recordroom-features.md` Part 4 and `docs/WORK-PLAN.md` §4
(most-important-first):

| # | Work | Why it is in scope | Gate |
|---|------|--------------------|------|
| 1 | **SQL Server full-text search** over the existing metadata columns; the registry search box becomes its frontend surface (v1 degrades toward ~25 lakh rows) | Search at scale before OCR exists (§3.1) | Search behaves at scale — sargable fix already in, FTS index over existing columns |
| 2 | **Custody chain** — intake register + return sign-off (`DigitizationCustodyEvent`); the previous plan had only the outbound half | Tender-critical; two directions both recorded: receiving+counting, and return + digital handover sign-off (§3.8) | Small, independent |
| 3 | **Editable permission matrix** — `role_permission` table, permission policies replacing `[Authorize(Roles = ...)]`, Admin row locked server-side, last-`users.edit`-holder guard | Enforcement is the actual goal; v1 keeps the two lists duplicated (§3.7) | The enforcement swap is its own reviewed commit — a policy that grants nothing must not lock operators out mid-deploy |
| 4 | **Scan composition studio** — thumbnail gallery, dnd-kit reorder persisted server-side, replace/insert/delete/duplicate/rotate per page, original-vs-processed compare before commit; entities `ScanPageAssets` + `DocumentDerivatives` | Turns "we store scans" into "we digitise properly" (§3.4); enhancements preserve the original scan | — |
| 5 | **PDF generation** — QuestPDF 2026.9.1 (ordered page images + invisible OCR text layer, header/footer, page numbers) and **PDF/A generation** at PDF/A-2b via `VellumPdf.Conformance` 2.3.3, with veraPDF as CI ground truth (§3.5–3.6) | Archival compliance — enhancing never overwrites the original scan | Confirm the contract's PDF/A level (QuestPDF cannot emit PDF/A-1) **(P)**; confirm QuestPDF licence eligibility (community licence has a revenue threshold) **(P)** |
| 6 | **Image quality gates** — OpenCvSharp5 5.0.0.20261012 (+ `official.runtime.linux-x64`, deploy target is Linux): deskew (median via `minAreaRect`, not mean), despeckle (`fastNlMeansDenoising`), binarise + small-component removal, document-quad crop, CLAHE, rotate; **DPI gate ≥ 200 at upload** with field-level error; original scan always preserved (§3.2) | Archival correctness of enhancements | — |
| 7 | **OCR** — POC on ~100 real district records **(G)** then the pipeline: Hangfire job modelled on the existing `mark-overdue-receipts`; models outside the web root, warmed per process; model version pinned per stored page; extracted text stored → full-text indexed (§3.3) | Everything else in the OCR chain depends on the engine choice | POC gate: pick an engine or stop. Candidates: `PaddleOcrNet` 2.4.0 (young, 12 versions) vs `PaddleOCR` 26.9.x (AOT-ready). Fallback `Tesseract` 5.2.0. `PaddleOCRSharp` is unusable (no Linux runtime, deploy target is Linux). No cloud OCR — data residency |
| 8 | **OpenSearch** — only if OCR-era relevance demands it (§3.1) | Avoid Elasticsearch (SSPL), `Lucene.Net` (stable is 2012-era; 4.8.0 is still beta) | — |

Note: the bare section numbers in the "Why it is in scope"/gate columns
(§3.1, §3.7…) refer to `docs/Recordroom-features.md` unless another file is
named.

Full library shortlist, do-not-adopt list and risks: `docs/Recordroom-features.md`
(Parts 3–6). v2 sequencing detail: `docs/Recordroom-features.md` Part 4 and
`docs/WORK-PLAN.md` §3–§4.

### 1.1 What has already shipped as v2 (context — no action)

Per the round-3/round-4 notes folded from root `TEMP-TODO.md` (now in
`docs/ignore/`):

- Scan studio reachable via `studio.use` (granted to all four roles by default,
  revocable) — `docs/TODO.md` §3a (2026-11-18)
- Hindi OCR pipeline (PDF text layer first, else rasterize + tesseract eng+hin,
  tessdata shipped in repo) — round 3
- Custody register + "Return…" partial counts (6 of 10, repeatable) +
  signed-off column — round 3
- File-view tracking (`audit.fileViews`, detail-GET audit rows, throttled) —
  round 3
- Dashboard "Final-scope gap check" (registry size, % mapped, issued, due,
  digitization %, e-office reference copy, metadata indexing, deliverable
  sign-off) — round 3
- Studio page edits/re-orders/reviews audited; deliverable regeneration
  tracking; studio Pending-approval flow — round 4
- departments managed list (name + code CRUD) under Administration — round 4
- `Permitted()` bug fix: feature-gated items actually hide — round 3
- Harness/web/API tests for all of the above (full pnpm round and
  `dotnet build`/`dotnet test` green)

## 2. Outstanding v1 items (still open)

- [ ] **D2 — verify scan auto-submit with the gun simulator.** Code is in
  `record-room-frontend/src/hooks/useScanAutoSubmit.ts` (wired into the
  issue-desk scan input); human typing/paste deliberately not auto-submitted.
- [ ] Barcode-gun simulator script — `scripts/barcode-gun.ahk` — **priority or
  later is still open** (`docs/TODO.md` §1 item 3).

## 3. Verification to do

Per `docs/TODO.md` §0–§5, `docs/WORK-PLAN.md` (v1 definition of done, v2 DoD),
`docs/QA.md` (production gates):

- [ ] `dotnet build` + `dotnet test` (unit + SQLite round-4 flow tests) +
      `pwsh dotnet-api/scripts/test-api.ps1`
- [ ] Full pnpm round: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
      `pnpm test` (live suites last — shares a 10-logins/60s budget with the
      API), `pnpm build`
- [ ] Browser walkthrough: add-scan end-to-end, bulk actions, command
      palette, small screens; PIN/password/OTP states; PDF reader in all
      three themes
- [ ] Confirm the SQL Server instance name **before** touching the API
      (ssh-tunnel prod-DB hazard — see `dotnet-api/README.md`)
- [ ] Production gates before production: API authorization, database
      transactions, file storage security, OCR quality, backup/restore, load
      tests (`docs/QA.md` §Production gates)

## 4. Waiting on the user

| Decision | Needed for |
|----------|------------|
| Supply ~100 real district records for the OCR POC | 6.7 hard gate (G) |
| Confirm QuestPDF licence eligibility | PDF/A generation (§1, item 5) |
| Confirm which PDF/A level the contract names (QuestPDF cannot emit PDF/A-1) | PDF/A generation (§1, item 5) |
| Confirm the SQL Server instance before destructive API test runs | every destructive API test run |
| Barcode-gun simulator priority vs later | D2 verify (§2) |
| `.gitattributes` + renormalisation — approved & done 2026-10-28 | (closed) |

## 5. Notes on files moved to `docs/ignore/`

Moved out of `docs/` (superseded/duplicated by the files above or by the code) —
**review and delete when you have** (they are in `docs/ignore/`, not gone):

- `docs/PROJECT-SCOPE.md`, `docs/CLARIFICATIONS.md`, `docs/PHASED-SCOPE.md` —
  absorbed into `docs/OVERVIEW.md`
- `docs/V2-EDITABLE-PERMISSIONS.md` — superseded by the rollout summary in
  §1, item 3; its design (role_permission table, Admin row locked,
  last-`users.edit`-holder guard) is what that rollout describes
- `docs/DIGITIZATION-DOCUMENT-UPLOAD.md` — describes the old metadata-only
  uploads as current; superseded by `docs/scanned-document-storage.md` and
  `docs/PRD.md` §8
- `docs/PRETEX-MASONRY-REFERENCE.md` — superseded by the
  `@chenglou/pretext` clarification in `docs/OVERVIEW.md`
- `docs/IMPLEMENTATION-TODO.md` — completion log; superseded by
  `docs/WORK-PLAN.md` / `docs/TODO.md` / this file
- `docs/VALIDATION-REPORT.md`, `docs/PERFORMANCE-AND-UX-REVIEW.md` — stale
  delivery reports; findings live in `docs/TODO.md` and the app
- root `TEMP-TODO.md` — folded into this file (v2 priority order, rounds 3–4
  scope notes, verification list now in §3)
