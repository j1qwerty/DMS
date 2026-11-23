# Document Management System (with an additional Record Room section)
## start the app
- run ` dotnet run --project dotnet-api\src\RecordRoom.Api --urls http://localhost:5199 ` in one terminal to start the server
- new terminal ` cd record-room-frontend ` then run ` npm i ` then run ` npm dev `


The product is a **Document Management System**: a document register with search
(full-text, OCR-backed), scanned-document storage with versioning, reports and
audit. The **Record Room** is an *additional section inside the same app* for
the physical files behind the documents: issue / return / movement, rooms and
shelves, and barcodes. It is built for ~25 lakh files.

v2 (digitization engine, custody chain, permission-matrix hardening) is in
progress — the single home of the outstanding scope is
[`docs/FINAL-SCOPE.md`](docs/FINAL-SCOPE.md). Product overview:
[`docs/OVERVIEW.md`](docs/OVERVIEW.md).

Barcode features belong to the Record Room section only and can be switched off with
one setting (default on). See `docs/BARCODE-SWITCH.md`. Open work, including the
API changes still to do, is tracked in `docs/TODO-DMS-RECORDROOM.md`.

## Repository layout

| Path | Status |
|---|---|
| `record-room-frontend/` | Complete React + TypeScript frontend, API-backed in `http` mode |
| `jhs_digitization-og-php-app/` | Legacy CodeIgniter PHP app — reference-only, do not edit |
| `dotnet-api/` | .NET 10 + SQL Server backend implementing the frontend service contract |
| `docs/` | Overview, final scope, PRD, feature inventory, architecture, data model, frontend spec, QA, security, gap report; `docs/docs-og/` and `docs/skills/` kept; superseded docs in `docs/ignore/` |

## Where to start

1. `docs/OVERVIEW.md` — product overview: scope, physical hierarchy, identifiers and barcodes
2. `docs/FINAL-SCOPE.md` — the outstanding v2 scope in one place (sequence, gates, waiting on user)
3. `docs/PRD.md` — master build spec (records, permissions and handover; implementation plan)
4. `docs/Recordroom-features.md` — feature inventory + verified v2 library shortlist + sequencing
5. `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`, `docs/FRONTEND-SPEC.md`
6. `docs/LEGACY-GAP-REPORT.md` — legacy-vs-frontend feature audit and status (all gaps closed)
7. `docs/TODO.md`, `docs/WORK-PLAN.md` — day-to-day tracker + v1/v2 living plan
8. `docs/QA.md`, `docs/SECURITY.md`, `docs/scanned-document-storage.md`, `docs/BARCODE-SWITCH.md`
9. `docs/TODO-DMS-RECORDROOM.md` — DMS/Record Room delivery status (phases 1–2 done)
10. `docs/TASTE-SKILL-REFERENCE.md` — design taste reference used for the frontend

Stale/superseded docs moved to `docs/ignore/` — review and delete at leisure.
Design system: `docs/skills/design.md`; workflow prefs: `docs/skills/react-pnpm-skill (1).md`.

## Frontend (the current build)

- Stack: React 19, TypeScript, Vite 7, Tailwind v4, Motion,
  `@chenglou/pretext`, TanStack Query (reserved for the API).
- **No Firebase.** This project does not use it (`AGENTS.md`); the dependency
  and the browser-side Firestore writer were removed. Inquiry and media pages
  are local-only until `dotnet-api/` provides endpoints.
- Data access goes through `src/services` — a typed service layer whose
  interfaces mirror the future API. Pages never import the seed data directly.
  The in-memory adapter persists to `localStorage` and publishes to React on
  every write, so a change on the issue desk appears on the movement log, the
  audit trail and the dashboard in the same tick.
- Routes: `/login`, `/`, `/search`, `/rooms`, `/rooms/:roomId`, `/files`,
  `/files/new`, `/files/:fileId`, `/issue`, `/return`, `/movement`,
  `/barcodes`, `/scan`, `/digitization`, `/digitization/:batchId`, `/reports`,
  `/support`, `/settings`, and `/admin/{users,employees,locations,bulk-import,maps,media,audit}`
  under their own administration layout.
- Setup: Node 22 + pnpm 10.15.0 — `corepack enable && corepack prepare
  pnpm@10.15.0 --activate && pnpm install && pnpm dev`. Full command and
  verify reference lives in `AGENTS.md`.
- Deploy: Netlify (`netlify.toml`, `pnpm build` → `dist`, SPA fallback). No
  environment variables required.

## Legacy app

`jhs_digitization-og-php-app/` is the original CodeIgniter 3 system (auth,
employee/digitization uploads with page versioning, file registry with barcode
checks, room→section→almirah→shelf hierarchy, single + multi-file issue/return,
reports/Excel exports, PDF stitching, OTP mobile API, ~14k `file_tbl` rows in
the shipped SQL dump). Keep it untouched; consult its controllers, models and
SQL before re-implementing any behaviour. Details in
`docs/LEGACY-GAP-REPORT.md`.

## Legacy live project

Live CodeIgniter app on the Contabo VPS (bare IP + port, HTTP only):

- URL: `http://147.93.155.185:8080/`
- Login: `admin` / `admin123` (shown + pre-filled on the login screen)
- Deploy: `.\deploy-lagacy-recordroom.ps1` (add `-SkipConfirm` for CI)
- Web root: `/var/www/legacy-recordroom/html`, nginx site `legacy-recordroom`

## Modern app live project

React frontend + .NET 10 API on the same Contabo VPS (bare IP + port, HTTP
only — a bare IP cannot get a normal TLS certificate):

- Web: `http://147.93.155.185:8083/` (SPA served by nginx, calls same-origin `/api`)
- API health: `http://147.93.155.185:8083/api/health` (proxied to the API on `127.0.0.1:5006`)
- Swagger: `http://147.93.155.185:8083/swagger/`
- Login: `admin` / `Demo@12345` (also `supervisor`, `operator`, `employee`; mobile PIN `1234`)
- Deploy: `.\deploy-recordroom.ps1` — interactive menu `1` API only, `2` web only, `3` both
  (or `-Target api|web|both -SkipConfirm` for CI)
- VPS layout: web root `/var/www/recordroom/html`, API `/var/www/recordroom/app`
  (systemd `recordroom-api`), env `/etc/recordroom/recordroom.env`,
  nginx site `recordroom`, SQL Server database `RecordRoom` + login `recordroom_app`
- The API applies EF migrations and seeds the demo dataset on first boot.
- **OCR & Fonts**: The OCR engine shells out to `tesseract` (`hin+eng`). The deployment script installs `tesseract-ocr`, `tesseract-ocr-eng`, `tesseract-ocr-hin`, plus `libfontconfig1`, `fonts-dejavu-core`, and `fonts-noto-devanagari` for QuestPDF Hindi deliverable PDF generation. The repo's `dotnet-api/tessdata/` models travel with the publish output. Full deployment guide in `dotnet-api/README.md`.

## Roadmap

v1 is the current build — its roadmap items are done (contract, API, deploy).
**v2 outstanding work is tracked in one file: `docs/FINAL-SCOPE.md`** (sequence,
gates, waiting on user). Confirmed v2 milestones already landed: scan studio,
Hindi OCR, custody returns, derivative review. Out of scope unless separately
approved (`docs/PRD.md` §3.2, §31): replacement of the broader ERP/HRMS systems,
3D digital twin, uncontrolled public access, AI-generated legal decisions.