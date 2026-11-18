> **Superseded for final acceptance:** this phase sketch predates the final Zila Panchayat proposal. Use [`../ZILA_PANCHAYAT_CODEX.MD`](../ZILA_PANCHAYAT_CODEX.MD) for the binding 1.1–1.4 scope and implementation status. In particular, movement tracking, barcode center, support/inquiry, media manager and bulk import are retained but hidden by default. OCR, e-office transfer, scan-quality gates, PDF composition and digital handover are required pending work, not optional advanced-phase extras.

# Phased frontend and product scope

## Phase 1. Core operational product

### Frontend pages

- Dashboard
- Record-room explorer
- Room visual map
- File registry
- File detail / locate flow
- Complete issue flow
- Complete return flow
- Movement tracking
- Barcode center
- Digitization batch list and detail
- Reports
- Users and roles
- Location designer
- Audit log
- Settings
- Support/inquiry
- Media/content link management

### Product capabilities represented

- Search physical files.
- Show exact room, almirah and shelf path.
- Show approximate shelf position visually.
- Explore all almirahs in a room.
- Drill into shelves.
- Track issue/return/movement.
- Link physical files to future digital copies.
- Show digitization status and exceptions.

## Phase 2. Backend and CMS/control layer

- .NET 10 API.
- SQL Server schema and migrations.
- Authentication and backend authorization.
- Location master CRUD.
- File master CRUD.
- Barcode jobs.
- Issue/return transactions.
- Audit trail.
- Document storage.
- Notifications.
- Reports.
- API-backed lightweight content administration where approved.

## Phase 3. Digitization and intelligent search

- Bulk import/reconciliation.
- Scan/OCR workers.
- Full-text indexing.
- Advanced filters.
- Semantic retrieval.
- Permission-aware AI search.
- Large report jobs.
- Operational dashboards.

## Phase 4. Integrations and advanced operations

- Dispatch integration.
- e-office/HRMS integrations where separately approved.
- Mobile camera scanner/PWA.
- Optional RFID.
- Advanced capacity planning.
- Additional integrations with approved government systems.
