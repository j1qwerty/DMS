# Barcode switch

**What:** one setting turns barcode features on or off. Default **on**.
**Scope:** Record Room section only. The document register, maps, digitization, reports and the rest of the
record room (issue, return, movement, rooms) are always available.

| Where | Setting |
|---|---|
| Frontend (build time, and the only source in local mode) | `VITE_ENABLE_BARCODE=true\|false` in `record-room-frontend/.env.local` |
| API | `Features:BarcodeEnabled` in `appsettings.json` or env `Features__BarcodeEnabled`; served to the UI at `GET /api/config`. `deploy-recordroom.ps1` writes it to the server env file (default true) and never overwrites a value you set |

In http mode the API value wins over the build-time value, so keep them the same.
Accepted "off" values: `false`, `0`, `off`, `no`, `disabled`.

## When off
Files are identified by **file number**. Page-by-page list: see the comment block in
`record-room-frontend/.env.example` (kept next to the variable on purpose).

Short version: no Scan or Barcode-labels pages (and their tabs, routes redirect to Documents); no barcode
values, inputs, images, copy/print actions or search hints; Issue adds files by searching file number or
subject; Digitization takes a file number; shelves and almirahs are created without a barcode field.

## What does not change
Each file still has an internal id (the old barcode value). It keeps maps, scans and history linked and
needs no data migration. It is simply not shown.

## API behaviour when off
`api/barcodes/*` and `files/by-barcode/{barcode}` answer 404; file number is accepted wherever a barcode was
(maps, digitization); new files and shelves get an internal id automatically; reports, permissions, movement
sentences and bulk-import messages stop mentioning barcodes. Details: `dotnet-api/README.md`.

## Testing both states
`pwsh dotnet-api/scripts/test-api.ps1` reads `/api/config` and checks the gating that matches the current state.
Run it once with the switch on and once with it off.
