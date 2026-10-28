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
