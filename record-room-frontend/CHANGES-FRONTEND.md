# Frontend changes (redesign + DMS framing + barcode switch)

The matching API changes are in `../dotnet-api` (see `../dotnet-api/CHANGES-API.md`). Status: `../docs/TODO-DMS-RECORDROOM.md`.

## Product framing
- Named **Document Management System** (title, login, sidebar, support text). The **Record room**
  (issue / return / movement, rooms & shelves, barcodes) is an additional section in the same shell.
- Menu: *Document management* (Documents, Maps, Digitization, Reports), *Record room*
  (Issue & return, Rooms & shelves), *Manage* (Overview, Administration). Related screens are tabs on
  the page: Issue & return -> Issue / Return / Movement log / Scan; Rooms -> Rooms / Barcode labels.
- Documents (`/files`) is the home page; the old dashboard is **Overview** (`/overview`).

## Barcode switch
- `VITE_ENABLE_BARCODE` (default `true`) in `.env.example`, with the full page-by-page list of what hides.
- In http mode the API's `GET /api/config` overrides it at runtime; if the API lacks it, the build-time value is used.
- Off means: no Scan / Barcode-labels pages or tabs (routes redirect to Documents), no barcode values or
  inputs anywhere, files are identified by **file number**. Issue works by searching file number; Digitization
  takes a file number; shelves/almirahs are created without a barcode field (an internal id is derived).
- Code: `src/lib/features.ts` (`useFeatures`, `hideFileIds`), `src/components/RequireFeature.tsx`,
  `src/lib/fileKey.ts` (find a file from typed text), `src/hooks/useFileLabels.ts`.

## UI
- Light sidebar that follows the theme. Files table with View / Upload / Move / Map actions; full-page
  viewer (`/files/:id/scan`, `/files/:id/map`); Maps page; Rooms with add / edit / delete.
- Phone: bottom tab bar (Documents, Maps, Scan or Digitize, Issue, More), cards instead of tables, sheets.
- Fixed unlayered CSS resets that overrode Tailwind utilities; defined missing colour utilities.

## Known limits (frontend)
- With barcodes off, stored map scan *file names* can still contain the internal id (they are file names the user
  uploaded or the server derived earlier).
- Fixed: the HTTP mapper for map pages read `barcode` but the API sends `fileBarcode`; it now reads both, plus the
  new `fileNumber` / `fileId`.
- Bulk import keeps its `barcode,subject,shelf` CSV header; only the on-screen labels change.
- The command palette is not part of this repo and was not touched.

## Round 4 — digitization workbench, demo-mode honesty, review flow

- **Which data layer is live is always visible**: the top bar shows a pulsing red dot + "Demo data"
  while the app runs on the in-browser dataset, green + "Live API" in http mode, each with a tooltip
  explaining how to switch. `.env.local` now ships with `VITE_API_MODE=http` /
  `VITE_API_BASE_URL=http://localhost:5199`, so `pnpm dev` talks to the real API out of the box
  (delete the file or set `local` for the offline demo; `pnpm test` pins local and is unaffected).
- **Demo files survive a refresh**: document bytes (scans, maps, built PDFs, record documents) are
  persisted in IndexedDB (`rr-documents`) and hydrated before the first render. Before, the lists
  persisted in localStorage but their files vanished on reload.
- **Fixed "by system" on custody rows**: `session.actorName()` read the in-memory session only, so a
  page-refresh-restored session wrote every actor as `system`. It reads `get()` now (same for
  `userName` / `role`).
- **Audit**: Logins and Issues are separate tabs (contract group `logins` / `issues`; the round-3
  `logins-issues` key still resolves).
- **Bulk import is hidden everywhere** (sidebar Administration gate, admin tab, Documents header,
  command palette). The route and page stay, still gated by `files.bulkImport`.
- **Digitization page**: no header text above the tabs; each queue row gets a **Preview** button
  (image/PDF viewer with download); "New digitization…" opens the workbench — pick a registered
  file or register a new one (`/files/new?intent=digitize`) and land straight in the studio.
- **Documents table**: every row gets an **Edit in studio** button (gated by `studio.use`).
- **Register file**: the upload accepts **one or many files** — PDFs become record document
  versions, images become page scans (they await review like any page scan). The success screen has
  a **Back to files** button and **Open in scan studio**; "Open file" no longer strands Back on
  `/files/new` (navigation state carries `from: '/files'`).
- **File details**: Back is smart (fresh tab or create-flow → `/files`, otherwise real history).
  The Scans section links into the studio and shows the latest deliverable PDF with its review
  status.
- **Scan studio** is the digitization workbench: **Scan / add pages** uploads one or many images or
  PDFs as the next pages; **Build deliverable PDF** produces a `Pending approval` build that a
  reviewer (with `digitization.review`) approves or rejects with a reason. Every build — rejected or
  approved — stays in the history with its bytes.
- **Settings** regrouped into sections (Connection & data, Interface, Feature visibility, Your
  session, Deployment); the demo reset now goes through `service.reset()` (it used to clear a
  stale `rr-db-v1` key and left documents behind). The local-dataset card only exists in demo mode.
- Local derivatives persist in the store (`derivatives` slice) + IndexedDB bytes; `ScanApi` gained
  `reviewPdf` and the scan `add` input gained `note`.
