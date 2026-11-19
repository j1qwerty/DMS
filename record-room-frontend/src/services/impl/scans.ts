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
import {
  localDocumentBlob,
  localDerivativeBlob,
  saveLocalRowDocument,
  saveLocalDerivativeBytes,
} from './document-storage';
import type { DocumentDerivative } from '../../types';
import { validateDocumentFile } from '../../lib/document';

const DOCUMENT_SIZES = ['A0', 'A1', 'A2', 'A3', 'A4', 'Other'];

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
      .sort(
        (a, b) =>
          (a.orderIndex ?? a.pageNo) - (b.orderIndex ?? b.pageNo) ||
          a.pageNo - b.pageNo ||
          a.version - b.version,
      )
      .map((row) => decorate(row, file.id, file.fileNumber));
  },

  async add(fileId, input) {
    const file = await filesService.get(fileId);
    if (!file) return err('File not found.', 'fileId');
    if (input.pageNo < 1) return err('Page number starts at 1.', 'pageNo');

    const size = input.documentSize.trim().toUpperCase() || file.documentSize || 'Other';
    if (!DOCUMENT_SIZES.includes(size)) {
      return err('Choose one of A0, A1, A2, A3, A4 or Other.', 'documentSize');
    }

    const siblings = store
      .getState()
      .scanPages.filter(
        (row) => row.fileBarcode === file.fileBarcode && row.pageNo === input.pageNo,
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
        after: `${page.filename} · v${page.version}`,
        summary: `Page ${page.pageNo} of ${file.fileBarcode} added`,
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
          summary: `Attached scan for page ${row.pageNo} of ${row.fileBarcode}`,
        });
      });
      return ok(updated);
    }

    const siblings = store
      .getState()
      .scanPages.filter(
        (item) => item.fileBarcode === row.fileBarcode && item.pageNo === row.pageNo,
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
      note: `Uploaded document version ${version} for page ${row.pageNo}.`,
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

  // -------------------------------------------------- scan studio (§3.4, §3.2)
  //
  // Local mode simulates the pixel work: rotations and enhancements are
  // recorded as labels on the page row (the UI flow is what matters here);
  // the HTTP adapter is the one that stores real processed copies, because
  // the API runs the OpenCV pipeline. Originals are never touched either way.

  async reorder(fileId, scanIds) {
    const file = await filesService.get(fileId);
    if (!file) return err('File not found.', 'fileId');
    if (scanIds.length === 0) return err('Give the page order as a list of scan ids.', 'scanIds');
    const known = store.getState().scanPages.filter((row) => row.fileBarcode === file.fileBarcode);
    const knownIds = new Set(known.map((row) => row.id));
    if (scanIds.some((id) => !knownIds.has(id))) {
      return err('Every scan id must belong to this file.', 'scanIds');
    }
    store.update((draft) => {
      scanIds.forEach((scanId, index) => {
        const row = draft.scanPages.find((item) => item.id === scanId);
        if (row) row.orderIndex = index + 1;
      });
      log(draft, {
        action: 'Update',
        entity: 'FileScanPage',
        entityId: fileId,
        before: 'composition order',
        after: `${scanIds.length} page(s) reordered`,
        summary: `${file.fileBarcode}: studio page order saved`,
      });
    });
    return ok(await scansService.list(fileId));
  },

  async runOcr(scanId) {
    // The local demo has no OCR engine; the API deployment rasterizes pages
    // and runs tesseract hin+eng. Here the pass returns what the page already
    // carries, or synthesizes the same one-line description the PDF build
    // uses, so the studio flow is complete in both modes.
    const row = store.getState().scanPages.find((item) => item.id === scanId);
    if (!row) return err('Scan page not found.', 'scanId');
    const file = store.getState().files.find((item) => item.fileBarcode === row.fileBarcode);
    const text =
      row.ocrText?.trim() ||
      `Page ${row.pageNo} of ${file?.fileNumber ?? row.fileBarcode} (${row.documentSize}).`;
    store.update((draft) => {
      const page = draft.scanPages.find((item) => item.id === scanId);
      if (page) page.ocrText = text;
      log(draft, {
        action: 'Update',
        entity: 'FileScanPage',
        entityId: scanId,
        before: row.ocrText?.trim() ? 'text present' : 'no text',
        after: `${text.length} characters`,
        summary: `OCR re-run for page ${row.pageNo} of ${row.fileBarcode}: demo mode`,
      });
    });
    return ok({
      scanId,
      barcode: row.fileBarcode,
      pageNo: row.pageNo,
      version: row.version,
      ocrText: text,
      method: 'demo',
      ranAt: timestamp(),
    });
  },

  async rotate(scanId, degrees) {
    const row = store.getState().scanPages.find((item) => item.id === scanId);
    if (!row) return err('Scan page not found.', 'scanId');
    if (![90, 180, 270].includes(degrees))
      return err('Rotation must be 90, 180 or 270 degrees.', 'degrees');
    store.update((draft) => {
      const page = draft.scanPages.find((item) => item.id === scanId);
      if (page) {
        page.enhancement = `rotated ${degrees}°`;
        page.hasProcessed = true;
      }
      log(draft, {
        action: 'Update',
        entity: 'FileScanPage',
        entityId: scanId,
        before: 'original',
        after: `rotated ${degrees}°`,
        summary: `Page ${row.pageNo} of ${row.fileBarcode} rotated (original kept)`,
      });
    });
    return ok({ ...row, enhancement: `rotated ${degrees}°`, hasProcessed: true });
  },

  async enhance(scanId, operation) {
    const labels: Record<string, string> = {
      deskew: 'deskewed',
      despeckle: 'despeckled',
      binarize: 'binarized',
      crop: 'cropped',
      contrast: 'contrast (CLAHE)',
    };
    const label = labels[operation];
    if (!label) return err('Unknown enhancement operation.', 'operation');
    const row = store.getState().scanPages.find((item) => item.id === scanId);
    if (!row) return err('Scan page not found.', 'scanId');
    store.update((draft) => {
      const page = draft.scanPages.find((item) => item.id === scanId);
      if (page) {
        page.enhancement = label;
        page.hasProcessed = true;
      }
      log(draft, {
        action: 'Update',
        entity: 'FileScanPage',
        entityId: scanId,
        before: 'original',
        after: label,
        summary: `Page ${row.pageNo} of ${row.fileBarcode} ${label} (original kept)`,
      });
    });
    return ok({ ...row, enhancement: label, hasProcessed: true });
  },

  async revert(scanId) {
    const row = store.getState().scanPages.find((item) => item.id === scanId);
    if (!row) return err('Scan page not found.', 'scanId');
    if (!row.hasProcessed) return err('This page has no processed copy to revert.', 'scanId');
    store.update((draft) => {
      const page = draft.scanPages.find((item) => item.id === scanId);
      if (page) {
        page.enhancement = undefined;
        page.hasProcessed = false;
      }
      log(draft, {
        action: 'Update',
        entity: 'FileScanPage',
        entityId: scanId,
        before: row.enhancement ?? 'processed',
        after: 'original',
        summary: `Page ${row.pageNo} of ${row.fileBarcode} reverted to the original scan`,
      });
    });
    return ok({ ...row, enhancement: undefined, hasProcessed: false });
  },

  async duplicate(scanId) {
    const row = store.getState().scanPages.find((item) => item.id === scanId);
    if (!row) return err('Scan page not found.', 'scanId');
    const siblings = store
      .getState()
      .scanPages.filter(
        (item) => item.fileBarcode === row.fileBarcode && item.pageNo === row.pageNo,
      );
    const nextVersion = siblings.reduce((max, item) => Math.max(max, item.version), 0) + 1;
    const nextOrder =
      store
        .getState()
        .scanPages.filter((item) => item.fileBarcode === row.fileBarcode)
        .reduce((max, item) => Math.max(max, item.orderIndex ?? item.pageNo), 0) + 1;
    const copy: FileScan = {
      ...row,
      id: newId('scan'),
      version: nextVersion,
      status: 'Pending review',
      note: `Duplicated from version ${row.version}.`,
      uploadedAt: timestamp(),
      uploadedBy: session.actorName(),
      orderIndex: nextOrder,
    };
    store.update((draft) => {
      draft.scanPages.push(copy);
      log(draft, {
        action: 'Create',
        entity: 'FileScanPage',
        entityId: copy.id,
        before: '-',
        after: `duplicate of v${row.version}`,
        summary: `Page ${row.pageNo} of ${row.fileBarcode} duplicated as version ${nextVersion}`,
      });
    });
    return ok(copy);
  },

  async scanBlob(scanId, variant) {
    // Local mode keeps one blob per page; the processed variant is the same
    // bytes (the enhancement is simulated). The API serves the real copy.
    void variant;
    return localDocumentBlob('page', scanId);
  },

  // Deliverable PDFs (§3.5), round 4: rows persist in the store and their bytes
  // in the IndexedDB document store, so the studio's history — including every
  // superseded build — survives a refresh. Local mode composes a real, minimal
  // text PDF from the pages' OCR text; the API composes the image deliverable
  // with QuestPDF.
  async listPdfs(fileId) {
    const file = await filesService.get(fileId);
    if (!file) return [];
    return store
      .getState()
      .derivatives.filter((row) => row.fileId === fileId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  },

  async buildPdf(fileId, filename, remarks) {
    const file = await filesService.get(fileId);
    if (!file) return err('File not found.', 'fileId');
    const pages = (await scansService.list(fileId)).filter(
      (row) => row.status !== 'Rejected' && row.hasDocument,
    );
    if (pages.length === 0) {
      return err(
        'No approved scan pages to build from: add or approve pages in the studio first.',
        'fileId',
      );
    }
    const texts = pages.map((row, index) => ({
      label: `${file.fileNumber} — ${file.subject} · page ${index + 1} of ${pages.length}`,
      text:
        row.ocrText?.trim() || `Page ${row.pageNo} of ${file.fileNumber} (${row.documentSize}).`,
    }));
    const bytes = composeLocalPdf(texts);
    const existingDerivs = store.getState().derivatives.filter((d) => d.fileId === file.id);
    const existingDocs = await filesService.listDocuments(file.id);
    const latestOriginal = existingDocs[0]?.filename ?? existingDerivs[0]?.filename;
    let computedName = filename?.trim();
    if (!computedName) {
      if (latestOriginal) {
        const clean = latestOriginal.replace(/\.pdf$/i, '').replace(/[_-]v\d+$/i, '');
        computedName = `${clean}_v${existingDerivs.length + 2}.pdf`;
      } else {
        computedName = `${file.fileNumber}_v1.pdf`;
      }
    }
    if (!computedName.toLowerCase().endsWith('.pdf')) computedName += '.pdf';

    const derivative: DocumentDerivative = {
      id: newId('derivative'),
      fileId: file.id,
      fileBarcode: file.fileBarcode,
      fileNumber: file.fileNumber,
      kind: 'Pdf',
      filename: computedName,
      sizeBytes: bytes.byteLength,
      sha256: '',
      pageCount: pages.length,
      sourceVersions: pages.map((row) => `#${row.id}:v${row.version}`).join(', '),
      includesOcrText: pages.some((row) => !!row.ocrText?.trim()),
      createdAt: timestamp(),
      createdBy: session.actorName(),
      // A fresh build waits for reviewer sign-off before it is the deliverable.
      status: 'Pending approval',
      reviewNote: remarks?.trim() || undefined,
    };
    await saveLocalDerivativeBytes(derivative.id, bytes);
    store.update((draft) => {
      draft.derivatives.unshift(derivative);
      log(draft, {
        action: 'Create',
        entity: 'DocumentDerivative',
        entityId: derivative.id,
        before: '-',
        after: `${derivative.filename}; pages=${derivative.pageCount}; status=pending approval`,
        summary: `Deliverable PDF built for ${file.fileBarcode} from ${pages.length} approved page(s)`,
      });
    });
    return ok(derivative);
  },

  async reviewPdf(derivativeId, decision, note) {
    const row = store.getState().derivatives.find((item) => item.id === derivativeId);
    if (!row) return err('Deliverable PDF not found.', 'derivativeId');
    if (row.status !== 'Pending approval') {
      return err(`This PDF was already ${row.status.toLowerCase()}.`, 'derivativeId');
    }
    if (decision === 'Rejected' && !note?.trim()) {
      return err('A rejection reason is required.', 'note');
    }
    const updated: DocumentDerivative = {
      ...row,
      status: decision,
      reviewedBy: session.actorName(),
      reviewedAt: timestamp(),
      reviewNote: note?.trim() || undefined,
    };
    store.update((draft) => {
      const index = draft.derivatives.findIndex((item) => item.id === derivativeId);
      if (index >= 0) draft.derivatives[index] = updated;
      log(draft, {
        action: decision === 'Approved' ? 'Approve' : 'Reject',
        entity: 'DocumentDerivative',
        entityId: derivativeId,
        before: 'pending approval',
        after: decision.toLowerCase(),
        summary: `${row.filename} ${decision.toLowerCase()} by ${updated.reviewedBy}`,
      });
    });
    return ok(updated);
  },

  async pdfBlob(derivativeId) {
    const blob = localDerivativeBlob(derivativeId);
    // A missing blob (cleared browser storage) still downloads an empty shell
    // rather than failing the whole studio, mirroring the old behaviour.
    return blob ?? new Blob([], { type: 'application/pdf' });
  },
};

/** A small, valid, text-only PDF: one page per sheet, with header lines. */
function composeLocalPdf(pages: Array<{ label: string; text: string }>): Uint8Array {
  const esc = (s: string) =>
    s
      .split('')
      .map((ch) => (ch === '(' || ch === ')' || ch === '\\' ? '\\' + ch : ch))
      .join('');
  const objects: string[] = [];
  const pageCount = pages.length;
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((page, index) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
    );
    const lines = [page.label, '', ...(page.text.match(/.{1,90}(?:\s|$)/g)?.slice(0, 40) ?? [])];
    const content =
      'BT /F1 10 Tf 40 800 Td 14 TL\n' +
      lines.map((line) => `(${esc(line)}) Tj T*`).join('\n') +
      '\nET';
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}
