import type { FileScan } from '../types';

/**
 * The authoritative page row per page number, for OCR display.
 *
 * Studio edits append their own rows for the same page numbers at the end of
 * the file's list. Without a merge the later rows shadow the file's current
 * pages — the OCR surface would show a still-unapproved studio draft's state
 * instead of the page the file actually has. Approved rows — the pages the
 * file shows as current — win; with no approved row the latest row stands.
 */
export function authoritativeScanRows(pages: FileScan[]): FileScan[] {
  const byKey = new Map<number, FileScan>();
  for (const page of pages) {
    const key = page.pageIndex ?? page.pageNo;
    const existing = byKey.get(key);
    if (existing?.status === 'Approved') continue;
    byKey.set(key, page);
  }
  return [...byKey.values()];
}
