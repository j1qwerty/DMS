import type { DocumentDerivative, FileScan, RecordFile } from '../types';
import type { ReviewChangeKind, ReviewFileGroup } from '../services/contracts';

/**
 * File-level review grouping (round 5). The pending queue used to show one row
 * per page, so a five-page rescan buried the register; this module folds the
 * pending pages and pending deliverable builds of each file into one group the
 * Review table renders as a single row. Pure on purpose: both service adapters
 * call it, and the unit tests exercise it without a browser.
 */

/**
 * How one pending page differs from the file's current state: a rescan or a
 * studio import replaces content the file already had (`updated`); a first
 * version of a page number is `new`.
 */
export function changeKindOf(scan: FileScan): ReviewChangeKind {
  if (scan.version > 1) return 'updated';
  if (/rescan|imported|duplicated/i.test(scan.note)) return 'updated';
  return 'new';
}

/** "3, 5, 8–10" — consecutive numbers fold into ranges. */
export function formatPageNumbers(numbers: number[]): string {
  const sorted = [...new Set(numbers)].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i += 1) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = current;
    prev = current;
  }
  return parts.join(', ');
}

type FileLike = Pick<RecordFile, 'id' | 'fileBarcode' | 'fileNumber' | 'subject' | 'department'>;

/** Folds the pending pages and pending builds into one group per file. */
export function groupPendingByFile(
  pendingPages: FileScan[],
  pendingPdfs: DocumentDerivative[],
  files: FileLike[],
): ReviewFileGroup[] {
  const byId = new Map(files.map((file) => [file.id, file]));
  const byBarcode = new Map(files.map((file) => [file.fileBarcode, file]));
  const groups = new Map<string, ReviewFileGroup>();

  const groupFor = (fileId: string, fileBarcode: string): ReviewFileGroup | undefined => {
    // Resolve the file first, then key by its registry id: a page that carries
    // the frontend id and a build that carries a stale one still land in the
    // same group because both resolve to the same file row.
    const file = byId.get(fileId) ?? byBarcode.get(fileBarcode);
    if (!file) return undefined; // the file left the registry; its rows cannot be reviewed
    const existing = groups.get(file.id);
    if (existing) return existing;
    const group: ReviewFileGroup = {
      fileId: file.id,
      fileBarcode: file.fileBarcode,
      fileNumber: file.fileNumber,
      subject: file.subject,
      department: file.department,
      pages: [],
      pdfs: [],
      lastActivityAt: '',
    };
    groups.set(file.id, group);
    return group;
  };

  for (const scan of pendingPages) {
    const group = groupFor(scan.fileId, scan.fileBarcode);
    if (!group) continue;
    group.pages.push({ scan, kind: changeKindOf(scan) });
    if (scan.uploadedAt > group.lastActivityAt) group.lastActivityAt = scan.uploadedAt;
  }
  for (const pdf of pendingPdfs) {
    const group = groupFor(pdf.fileId, pdf.fileBarcode);
    if (!group) continue;
    group.pdfs.push(pdf);
    if (pdf.createdAt > group.lastActivityAt) group.lastActivityAt = pdf.createdAt;
  }

  // Composition order inside a group: the studio's orderIndex first, then page.
  for (const group of groups.values()) {
    group.pages.sort(
      (a, b) =>
        (a.scan.orderIndex ?? a.scan.pageNo) - (b.scan.orderIndex ?? b.scan.pageNo) ||
        a.scan.pageNo - b.scan.pageNo,
    );
  }

  return [...groups.values()].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}
