# TEMP task tracker (working notes — fold into docs/TODO.md as items complete)

Order of work, per user direction (2026-10-29): finish all v1 features → v2
most-important-first → thorough tests at the end. Simple API checks when a
change touches the API; no browser walkthrough until everything is built.

## v1 — remaining

- [x] E3 skeleton loaders (tables + card rows) — commit `Skeletons.tsx` + 7 pages
- [x] **E4 bulk selection + bulk actions on the registry** — committed
      checkbox column + card checkboxes, select-page-all, bulk bar:
      Relocate… / Export selected / Clear; BulkMoveModal loops
      `files.relocate` per file (issued files skipped with a count), CSV
      reuses the page export columns
- [x] E5 registry table sticky header + column show/hide
- [x] E6 one consistent flash/toast location
- [x] E7 responsive audit below 768px: registry (card list already), issue desk
      (borrower list as cards below md), location designer (overflow fixed
      earlier); Modal is a bottom sheet on phones; other wide admin tables
      scroll inside overflow containers by design
- [x] E8 command palette (`/` or Ctrl/Cmd+K): debounced registry search with
      per-result match context, recent files (recorded on detail-page visits),
      recent searches (recorded on every registry search), role-filtered
      page jumps; arrow/enter navigation inside the E2 modal

## v2 — most important first (proposal; confirm with user before starting)

1. **6.2 FTS search** — SQL Server full-text over metadata columns; registry
   search box becomes its surface (D1 already made the query sargable)
2. **3.8 Custody chain** — intake register + return sign-off (tender-critical)
3. **3.7 Editable permission matrix** — server-enforced roles (design doc:
   `V2-EDITABLE-PERMISSIONS.md`)
4. **6.6 Scan composition studio** — page reorder/replace/rotate gallery
5. **6.7 PDF generation from scans** — QuestPDF (licence check first)
6. 6.3 Image quality gates (OpenCvSharp5) — heavy; needs decision
7. 6.4/6.5 OCR — **blocked (P)**: user must supply ~100 real records for the
   POC gate first

## Verification (after all building is done)

- [ ] `dotnet build` + `dotnet test` + harness (needs ≥110 s API idle before a run)
- [ ] full pnpm round: format:check, lint, typecheck, test (live suites last),
      build
- [ ] browser walkthrough: add-scan flow end-to-end, bulk actions, palette,
      small screens; PIN/password/OTP states; PDF reader in three themes
- [ ] fold notes back into docs/TODO.md, delete this file

## Round 3 (2026-11-18) — UI corrections + final-scope closing

Feedback round after the v2 ZIP; work branch `v2` only. Tracked here and in
the session todo list; ZILA_PANCHAYAT_CC.MD §V/§T updated at the end.

### UI

- [x] Menu: Overview first; drop the separate Maps entry (same page as
      Documents) and Help & support; one "Digitization" entry whose page tabs
      Scan review queue + Custody register; fix `permitted()` so feature-gated
      items actually hide (bug: items without `anyOf` skipped the feature
      check, so Rooms/Maps/Help showed and bounced to /files)
- [x] Contrast: add `@custom-variant dark` (dark: followed the OS media query,
      not the .dark class — black text on blue on OS-dark machines); accent
      fills get white text in both themes; active tabs solid accent + white
- [x] Logged-in user shown on topbar only (remove the sidebar footer card)
- [x] Permission matrix alignment: fixed table layout, stable column widths,
      nowrap capability labels
- [x] Custody "Record handover": Digitization batch prefilled with a
      date-time prefix (editable); same helper reused for other reference
      fields
- [x] Custody register: "Return…" button on an intake row records a return
      against that batch (partial counts like 6 of 10 allowed, repeated until
      fully returned); Returned column shows x/y; view-details icon (recorded
      by, counted by, signed off by, returns against the batch); Signed-off
      column names the signer
- [x] Issue desk: one employee combobox — results as you type, pick from the
      list; a name that matches nothing is saved as typed with a clear
      "not in the employee database" notice (no separate search + select
      columns)
- [x] Departments: managed list (name + code CRUD) under Administration;
      employee/custody/file forms pick from it instead of free text

### Scope / features

- [x] Audit page regrouped into exactly: Documents / Digitization / Logins &
      issues / File views (the reports page stays as is)
- [x] File-view tracking: who opened which file, when (detail-GET audit rows,
      throttled); File views tab gated by a new `audit.fileViews` permission
      (Admin by default, grantable)
- [x] Scan studio: reachable (button on the file page), gated by a new
      `studio.use` permission (granted to all four roles by default,
      revocable)
- [x] Deliverable regeneration tracking: each built PDF records who/when/page
      count; page edits/re-orders/reviews audited (full edit trail)
- [x] Hindi OCR: real pipeline — PDF text layer first, else rasterize +
      tesseract eng+hin (tessdata shipped in-repo); wired into scan upload and
      a re-run endpoint; verified on a rendered Hindi test page
- [x] Final-scope gap check: dashboard (registry size, % mapped, issued, due,
      digitization %), e-office reference copy, metadata indexing, deliverable
      sign-off
- [x] Tests for all of the above (web, API unit, harness)
- [x] Final ZIP refreshed in /home/z/my-project/download/

## Round 4 (2026-11-18) — digitization workbench + review flow

User feedback round, all items done. Frontend details in
`record-room-frontend/CHANGES-FRONTEND.md` (round-4 section); API details in
`dotnet-api/CHANGES-API.md`.

### Done

- [x] Demo-mode indication: topbar red-dot "Demo data" badge (green "Live API"
      in http mode); `.env.local` now ships with `VITE_API_MODE=http` +
      `http://localhost:5199` so `pnpm dev` uses the real API out of the box
- [x] Demo persistence: document bytes in IndexedDB, hydrated at boot —
      uploads, built PDFs and record documents survive a refresh
- [x] "by system" custody actor fixed (session read from storage after
      refresh)
- [x] Audit: Logins / Issues as separate tabs (groups `logins`, `issues`)
- [x] Bulk import hidden from the UI everywhere (route stays, gated)
- [x] Digitization page: header text removed; queue rows preview scans;
      "New digitization…" workbench (pick or register a file → studio)
- [x] Documents table: per-row "Edit in studio" (studio.use)
- [x] Register file: multi-file upload (images→page scans, PDFs→record
      versions), success-screen Back, Open in studio, `?intent=digitize`
      lands in the studio after creation
- [x] File details: smart Back; Scans section shows the latest deliverable and
      links to the studio
- [x] Studio: "Scan / add pages" multi-upload; built PDFs are Pending
      approval until a reviewer approves/rejects (reason required); every
      build kept in history
- [x] Settings regrouped (Connection & data / Interface / Feature visibility /
      Your session / Deployment); demo reset actually resets (stale key bug)
- [x] API: review endpoint + migration (existing rows backfill Approved);
      audit groups split; QuestPDF 2026.9 font bug + Hindi-glyph fallback
      fixed (both found by the new tests)
- [x] Tests: 10 SQLite flow tests (real services, real disk store, DB row
      + file assertions), 10 frontend round-4 tests, api-contract additions,
      harness block for the review flow + audit groups; full pnpm round and
      dotnet build/test green
