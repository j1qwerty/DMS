/**
 * File-centric digitization (2026-10-28 decision): every file carries its own
 * scan pages — a full PDF goes through the documents API, page-by-page scans
 * land here — and the Digitization section is the pending-review queue across
 * files. The legacy employee/folder batches are gone.
 *
 * The version rules match the legacy `upload_file` behaviour: a repeated
 * file + `pageNo` pair becomes the next `version` rather than an overwrite,
 * and a rescan of a page that already has an `Active` copy is flagged
 * `Duplicate`.
 */

import { err, ok, type ScanApi } from '../contracts';
import { newId, store, timestamp } from '../store';
import type { FileScan } from '../../types';
import { log } from './audit';
import { filesService } from './files';
import { session } from './session';
import { localDocumentBlob, saveLocalRowDocument } from './document-storage';
import { validateDocumentFile } from '../../lib/document';

const DOCUMENT_SIZES = ['A0', 'A1', 'A2', 'A3', 'A4', 'Legal', 'Other'];

function decorate(row: FileScan, fileId: string, fileNumber?: string): FileScan {
  return { ...row, fileId, fileNumber: fileNumber ?? row.fileNumber };
}

export const scansService: ScanApi = {
  async list(fileId) {
    const file = await filesService.get(fileId);
    if (!file) return [];
    return store
      .getState()
      .scanPages.filter((row) => row.fileBarcode === file.fileBarcode)
      .sort((a, b) => a.pageNo - b.pageNo || (a.side ?? 'Front').localeCompare(b.side ?? 'Front') || a.version - b.version)
      .map((row) => decorate(row, file.id, file.fileNumber));
  },

  async add(fileId, input) {
    const file = await filesService.get(fileId);
    if (!file) return err('File not found.', 'fileId');
    if (input.pageNo < 1) return err('Page number starts at 1.', 'pageNo');

    const requestedSize = input.documentSize.trim() || file.documentSize || 'Other';
    const size = DOCUMENT_SIZES.find(
      (candidate) => candidate.toLowerCase() === requestedSize.toLowerCase(),
    );
    if (!size) {
      return err('Choose one of A0, A1, A2, A3, A4, Legal or Other.', 'documentSize');
    }

    const requestedSide = input.side ?? 'Front';
    if (!['Front', 'Back'].includes(requestedSide)) {
      return err('Choose Front or Back for the scanned page side.', 'side');
    }
    const side = requestedSide;
    const siblings = store
      .getState()
      .scanPages.filter(
        (row) =>
          row.fileBarcode === file.fileBarcode &&
          row.pageNo === input.pageNo &&
          (row.side ?? 'Front') === side,
      );
    const nextVersion = siblings.reduce((max, row) => Math.max(max, row.version), 0) + 1;

    const page: FileScan = {
      id: newId('scan'),
      fileId: file.id,
      fileBarcode: file.fileBarcode,
      fileNumber: file.fileNumber,
      filename:
        input.filename.trim() ||
        `${file.fileBarcode}-FILE-${input.pageNo}${nextVersion > 1 ? `-V${nextVersion}` : ''}.pdf`,
      pageNo: input.pageNo,
      side,
      version: nextVersion,
      documentSize: size,
      status:
        nextVersion > 1 && siblings.some((row) => row.status === 'Active')
          ? 'Duplicate'
          : 'Pending review',
      note:
        nextVersion > 1 ? `Rescan of an existing page (previous version ${nextVersion - 1}).` : '',
      uploadedAt: timestamp(),
      uploadedBy: session.userName(),
    };

    store.update((draft) => {
      draft.scanPages.push(page);
      log(draft, {
        action: 'Create',
        entity: 'FileScanPage',
        entityId: page.id,
        before: '—',
        after: `${page.filename} · ${page.side} · v${page.version}`,
        summary: `${page.side} of page ${page.pageNo} of ${file.fileBarcode} added`,
      });
    });
    return ok(page);
  },

  async addDocument(scanId, file) {
    const issue = validateDocumentFile(file);
    if (issue) return err(issue, 'document');
    const row = store.getState().scanPages.find((item) => item.id === scanId);
    if (!row) return err('Scan page not found.', 'scanId');

    // A metadata-only registration is filled in place — registering the page
    // and attaching its scan is one page, not two versions. Attaching to a row
    // that already has content is a rescan and becomes the next version.
    if (!row.hasDocument) {
      const info = await saveLocalRowDocument('page', row.id, file);
      const updated: FileScan = {
        ...row,
        filename: file.name,
        status: row.status === 'Duplicate' ? 'Duplicate' : 'Pending review',
        note: `Attached scan for page ${row.pageNo}.`,
        uploadedAt: timestamp(),
        uploadedBy: session.userName(),
        hasDocument: true,
        contentType: info.contentType,
        sizeBytes: info.sizeBytes,
        pageCount: info.pageCount,
      };
      store.update((draft) => {
        const index = draft.scanPages.findIndex((item) => item.id === scanId);
        if (index >= 0) draft.scanPages[index] = updated;
        log(draft, {
          action: 'Update',
          entity: 'FileScanPage',
          entityId: scanId,
          before: row.filename,
          after: `${file.name}; bytes=${info.sizeBytes}`,
          summary: `Attached scan for the ${row.side ?? 'Front'} of page ${row.pageNo} of ${row.fileBarcode}`,
        });
      });
      return ok(updated);
    }

    const siblings = store
      .getState()
      .scanPages.filter(
        (item) =>
          item.fileBarcode === row.fileBarcode &&
          item.pageNo === row.pageNo &&
          (item.side ?? 'Front') === (row.side ?? 'Front'),
      );
    const version = siblings.reduce((max, item) => Math.max(max, item.version), 0) + 1;

    const created: FileScan = {
      ...row,
      id: newId('scan'),
      filename: file.name,
      version,
      status:
        version > 1 && siblings.some((item) => item.status === 'Active')
          ? 'Duplicate'
          : 'Pending review',
      note: `Uploaded document version ${version} for the ${row.side ?? 'Front'} of page ${row.pageNo}.`,
      uploadedAt: timestamp(),
      uploadedBy: session.userName(),
      hasDocument: true,
    };

    const info = await saveLocalRowDocument('page', created.id, file);
    created.contentType = info.contentType;
    created.sizeBytes = info.sizeBytes;
    created.pageCount = info.pageCount;

    store.update((draft) => {
      draft.scanPages.push(created);
      log(draft, {
        action: 'Create',
        entity: 'FileScanPage',
        entityId: created.id,
        before: `page=${row.pageNo}; version=${row.version}`,
        after: `${file.name}; version=${version}; bytes=${info.sizeBytes}`,
        summary: `Uploaded ${file.name} as version ${version} for ${row.fileBarcode}`,
      });
    });
    return ok(created);
  },

  async scanBlob(scanId) {
    return localDocumentBlob('page', scanId);
  },

  async remove(scanId) {
    const state = store.getState();
    const page = state.scanPages.find((row) => row.id === scanId);
    if (!page) return err('Scan page not found.', 'scanId');
    if (page.status === 'Approved' && session.role() !== 'Admin') {
      return err('Approved scans can only be removed by an admin.', 'scanId');
    }

    store.update((draft) => {
      draft.scanPages = draft.scanPages.filter((row) => row.id !== scanId);
      log(draft, {
        action: 'Delete',
        entity: 'FileScanPage',
        entityId: scanId,
        before: `${page.filename} · v${page.version}`,
        after: 'deleted',
        summary: `Page ${page.pageNo} scan removed from ${page.fileBarcode}`,
      });
    });
    return ok(true);
  },

  async review(scanId, decision, note) {
    const page = store.getState().scanPages.find((row) => row.id === scanId);
    if (!page) return err('Scan page not found.', 'scanId');
    if (decision === 'Rejected' && !note.trim()) {
      return err('A rejection reason is required.', 'note');
    }

    const updated: FileScan = {
      ...page,
      status: decision === 'Approved' ? 'Approved' : 'Rejected',
      note: note.trim() || page.note,
    };
    store.update((draft) => {
      const index = draft.scanPages.findIndex((row) => row.id === scanId);
      if (index >= 0) draft.scanPages[index] = updated;
      log(draft, {
        action: decision === 'Approved' ? 'Approve' : 'Reject',
        entity: 'FileScanPage',
        entityId: scanId,
        before: `status=${page.status}`,
        after: `status=${updated.status}`,
        summary: `${page.filename} ${updated.status.toLowerCase()}`,
      });
    });
    return ok(updated);
  },

  async reviewAll(fileId, decision, note) {
    const file = await filesService.get(fileId);
    if (!file) return err('File not found.', 'fileId');
    if (decision === 'Rejected' && !note.trim()) {
      return err('A rejection reason is required.', 'note');
    }

    const pending = store
      .getState()
      .scanPages.filter(
        (row) => row.fileBarcode === file.fileBarcode && row.status === 'Pending review',
      );
    if (pending.length === 0) return err('No pages are awaiting review.', 'fileId');

    const status = decision === 'Approved' ? 'Approved' : 'Rejected';
    const trimmed = note.trim();
    store.update((draft) => {
      for (const row of draft.scanPages) {
        if (row.fileBarcode === file.fileBarcode && row.status === 'Pending review') {
          row.status = status;
          if (trimmed) row.note = trimmed;
        }
      }
      log(draft, {
        action: decision === 'Approved' ? 'Approve' : 'Reject',
        entity: 'FileScanPage',
        entityId: fileId,
        before: `pending=${pending.length}`,
        after: `${status.toLowerCase()}=${pending.length}`,
        summary: `${file.fileBarcode}: ${pending.length} page(s) ${status.toLowerCase()}`,
      });
    });
    return ok(pending.length);
  },

  async pending(query = {}) {
    const search = query.search?.trim().toLowerCase() ?? '';
    const files = store.getState().files;
    const fileByBarcode = new Map(files.map((f) => [f.fileBarcode, f]));
    return store
      .getState()
      .scanPages.filter((row) => row.status === 'Pending review')
      .filter((row) => {
        if (!search) return true;
        const haystack =
          `${row.fileBarcode} ${row.filename} ${fileByBarcode.get(row.fileBarcode)?.fileNumber ?? ''}`.toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
      .slice(0, 200)
      .map((row) => {
        const file = fileByBarcode.get(row.fileBarcode);
        return decorate(row, file?.id ?? '', file?.fileNumber);
      });
  },

  async pendingReviewCount() {
    return store.getState().scanPages.filter((row) => row.status === 'Pending review').length;
  },
};
