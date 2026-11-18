> **Final proposal override (2026-11-18):** This document records earlier project assumptions and is not the current acceptance scope. The final Zila Panchayat proposal and its clause-by-clause work status are authoritative in [`../ZILA_PANCHAYAT_CODEX.MD`](../ZILA_PANCHAYAT_CODEX.MD). Do not treat barcode/movement/support/bulk-import functions as current user-visible scope; retain them behind disabled-by-default feature flags. Do not describe OCR search, e-office upload, final PDF production, quality gates or digital handover as out of scope.

# Project scope and source decisions

## Product

Record Room Software for physical record management, digitization, tracking, search, room visualization, issue/return, digital document access, reports, alerts and audit.

## Core physical scope

- Approximately 25 lakh physical files.
- Up to two barcode labels can be attached to each physical file, both resolving to the same permanent file identity.
- Rooms, buildings, floors, almirahs/racks and shelves receive human-readable codes and barcodes.
- Each file has an exact current location and an approximate position on its shelf for visual guidance.
- Physical movement must not change the permanent file identity.

## Software scope

- Web-based application.
- Record-room visual explorer.
- File registry.
- Barcode creation and scanning.
- Issue and return.
- File movement tracking.
- Digital document view/download/print.
- OCR and full-text search.
- Controlled AI-assisted search.
- Role, designation and permission management.
- Reports in PDF and Excel.
- Alerts and notifications.
- Digitization operations and training support.

## Frontend-first scope for this delivery

This project is intentionally frontend-first. It provides a production-oriented React application with realistic mock data behind a typed service layer, full navigation, visual record-room UI, scanner-first flows, settings, admin surfaces, local-only inquiry and media-link storage, external image-link management, and Netlify deployment configuration. Firebase is deliberately absent.

The .NET backend, SQL Server database, OCR workers and production authentication are documented but are not included as executable services in this frontend package.
