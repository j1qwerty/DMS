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
