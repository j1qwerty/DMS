# Fix notes — "/files/:id pages keep refreshing" (commit 69523de, v2 branch)

## Symptom

- `http://localhost:5173/files/4` and `http://localhost:5173/files/4/scan` (any file
  detail page that has a document to show) kept refreshing: the whole screen
  flashed to the app's "Loading…" fallback and back roughly 2–3 times per second.
- The browser DevTools console showed **no warnings and no errors** — every
  network request succeeded; it was a silent render loop.

Reproduced headlessly against a stub API: the full request set of the page
(`GET /api/files/4`, `/scans`, `/documents`, `/pdf`, `/api/movements/file/4`,
`/api/issues`, the 647 KiB PDF blob, and even `GET /api/health` from the topbar)
re-fired **every ~400 ms** — 49 rounds of `GET /api/files/4/scans` in 17 seconds.

## Root cause — the exact chain

1. `react-pdf` **v11** suspends by default: `Document` has `suspense = true`
   (`node_modules/react-pdf/dist/Document.js` — `useResource(..., suspense, ...)`
   throws the load promise while the PDF source/document is not cached).
2. `record-room-frontend/src/components/files/PageOcrViewer.tsx` rendered
   `<Document>` **without a local `<Suspense>`**. It was the only react-pdf call
   site in the app missing one — `DocumentViewer.tsx` (line ~178),
   `DocumentUploadActions.tsx` (line ~240) and `ScanStudioPage.tsx` (line ~1330)
   all wrap their viewer in a local `<Suspense>`.
3. The suspension therefore bubbled all the way up to the app-shell boundary
   `<Suspense fallback={<RouteFallback/>}>` in `record-room-frontend/src/App.tsx`
   (line ~127): **the entire shell — topbar, sidebar, page — unmounted into the
   "Loading…" fallback**.
4. When the PDF resolved and the tree was revealed again, React re-ran every
   effect in the tree (`reconnectPassiveEffects`). PageOcrViewer's blob effect
   was among them: it re-fetched the document, **created a NEW object URL**
   (`URL.createObjectURL`) and called `setUrl(newUrl)`.
5. react-pdf keys its document cache on the `file` prop — a new URL string is a
   cache miss, so `<Document file={newUrl}>` **suspended again** → the app
   flipped to the fallback again → every effect re-ran again → **infinite loop**.
   Each cycle cost one full request round including the PDF re-download.
6. Why the console stayed clean: nothing actually failed — each request
   succeeded; the loop is pure React commit churn. (`verbosity: 0` in
   `PDF_OPTIONS`, added in 69523de, additionally silences pdf.js console output.)

## The fix

**File changed: `record-room-frontend/src/components/files/PageOcrViewer.tsx` (the only file)**

- Added `Suspense` to the React import.
- Wrapped the react-pdf `<Document>...</Document>` block in a local
  `<Suspense fallback={… "Loading document…" …}>`, so a PDF load only swaps the
  reader pane, never the app shell.

With the boundary local to the reader: the blob effect never re-runs on a PDF
load, the object URL stays stable, react-pdf's cache hits after the first load,
and the loop cannot start. The visual behaviour is unchanged for the user — the
same "Loading document…" placeholder shows inside the reader while a PDF loads.

## Verification

- Headless browser against a stub API, DOM-mutation counter over 5 s per route:
  - `/files/4` — 0 mutations (before the fix: 26 per 5 s)
  - `/files/4/scan` — 0 mutations, 2 requests total (before: every ~400 ms)
  - `/files/4/ocr` — 0 mutations
  - `/files/4/studio` — 0 mutations
  - `/files` (list) — 0 mutations
  - The PDF renders (canvas present, page counter `1 / 6`).
- `npx tsc --noEmit` — clean. `npm run build` — clean.
- `npm test` — 181 passed; the 2 live-API contract suites
  (`tests/api-contract.test.ts`, `tests/realtime.test.ts`) skip as designed when
  no .NET API is running on :5199.

## Not this bug (checked and ruled out)

- `ScanStudioPage.tsx` polls every 3 s **while any scan page is `Processing`** —
  that is by design (the round-4 background-OCR feature: status dots flip when
  the OCR job lands) and causes no visible churn.
- The `realtime.ts` visibility/wake and `onclose` changes from 69523de are
  sound; the SignalR negotiation errors seen while reproducing came from the
  stub having no hub, not from the app.
- Reminder from round 4: with in-memory Hangfire storage, an API restart loses
  pending OCR jobs, so pages uploaded right before a restart can stay
  `Processing` until re-OCR'd — unrelated to this refresh loop.
