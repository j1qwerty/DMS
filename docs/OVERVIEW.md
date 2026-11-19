# Record Room — product overview

Snapshot: 2026-11-19 (docs reorganised — the outstanding v2 scope is consolidated
in `docs/FINAL-SCOPE.md`; the master build spec is `docs/PRD.md`).

A web-based physical record management, file tracking, digitization and
document access platform — a Document Management System ("Documents" surface)
with an additional Record Room section inside the same app for the physical
files behind the documents. Built for ~25 lakh files (~2.5M).

## Physical model

Tenant / Organization → Site → Building → Floor → Room → StorageUnit (Almirah /
Rack / Cabinet / open-rack / other) → Shelf → ShelfSection → PhysicalFile. Every
physical object gets a human-readable code and a barcode. Every file gets a
permanent identity that is separate from its location.

## Identifiers and barcodes

- Permanent file ID: `RF-##########` (e.g. `RF-0000000001`) — stable for the
  life of the deployment, immutable across moves (`docs/PRD.md` §8.1).
- Location address: `SITE-001 / BLD-001 / FL-02 / RM-004 / A-012 / S-05`.
- Barcodes: Code 128 for linear labels (QR for camera-based mobile scanning);
  the payload identifies the object, not the mutable location; the
  human-readable value is printed adjacent; two labels may point to the same
  file ID; barcode uniqueness is enforced at the database level.
- Barcode features belong to the Record Room section only and are switchable
  (`VITE_ENABLE_BARCODE`, default on — see `docs/BARCODE-SWITCH.md`).

## Core capabilities

- File registry: search (structured + OCR text + full-text), filter/sort/page,
  CSV export, duplicate detection on create, permanent RF IDs
  (`docs/PRD.md` §12.2, `docs/FRONTEND-SPEC.md`).
- Record-room visual explorer: SVG maps, occupancy, drill-down to shelf level,
  approximate shelf-position guidance (`docs/PRD.md` §17).
- Issue / return / movement with barcode-controlled workflows and complete
  audit history; multi-file issue, partial returns, movement log
  (`docs/PRD.md` §12.3–12.5).
- Digital document storage: signed URLs, SHA-256 checksums, encrypted at rest,
  48 MiB ceiling, page counts for PDFs (`docs/scanned-document-storage.md`).
- Digitization: page scans, per-page versioning, approve/reject with reasons
  (`docs/scanned-document-storage.md`, `docs/TODO.md` §3a).
- OCR + full-text search; SQL Server FTS is the planned search plan
  (`docs/FINAL-SCOPE.md` §1, item 1).
- Reports/dashboards, alerts, audit log, role matrix (v1 read-only — the
  editable matrix is v2, `docs/FINAL-SCOPE.md` §1, item 3).
- Server monolith + background worker (`docs/ARCHITECTURE.md`); production
  authorization and the live deployment (`.NET 10 API`, SQL Server) are
  tracked in `dotnet-api/` (`docs/TODO-DMS-RECORDROOM.md`).
- Bulk import with two-phase validate → commit and reconciliation sessions
  (`docs/Recordroom-features.md` Part 2 / Stage 11).

## Phasing

- Phase 1 (done — current build): Documents + Record Room v1. Tracker:
  `docs/TODO.md`; parity with the legacy app: `docs/LEGACY-GAP-REPORT.md`;
  checklist: `docs/QA.md`.
- Phase 2 (in progress): v2 digitization engine + platform hardening — the
  outstanding work is consolidated in `docs/FINAL-SCOPE.md`.
- Phases 3–4 (later — legacy roadmap): mobile camera scanner/PWA, RFID for
  high-volume movement, CCVT/CCTV event linking, automated reconciliation,
  permission-filtered AI search, semantic search with multiple embedding
  models, e-office/HRMS/dispatch/archival system integration, predictive
  storage planning (`docs/PRD.md` §31).

## Design clarifications (resolved decisions)

- File identity is separate from physical location; moving never changes the
  RF ID (`docs/PRD.md` §1.1).
- Human-readable codes are simple; the compound address is displayed as
  `SITE / BLD / FL / RM / A / S` (`docs/PRD.md` §8.3).
- Barcodes carry object identities, not mutable location strings
  (`docs/PRD.md` §8.4).
- Shelf position is approximate (file order + a position percent), not exact
  (`docs/PRD.md` §8.5).
- The first visualizer is 2D SVG; 3D is deferred (`docs/PRD.md` §5; the
  clarification is recorded here).
- Motion is restrained and functional; `prefers-reduced-motion` is respected.
- External image links are validated in-browser (http(s) only, preview must
  succeed before the URL is stored).
- Design system: Tailwind v4, one muted teal accent, cool grey foundation,
  Pretext for text measurement, local `PretextMasonry` component
  (`docs/FRONTEND-SPEC.md`; findings now in `docs/TODO.md` §4).

## Status

v1 is complete and green (`docs/TODO.md`, `docs/LEGACY-GAP-REPORT.md` — all
closed). v2 work is tracked in one file: `docs/FINAL-SCOPE.md`.
