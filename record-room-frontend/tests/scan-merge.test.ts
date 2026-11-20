import { describe, expect, it } from 'vitest';
import type { FileScan } from '../src/types';
import { authoritativeScanRows } from '../src/lib/scanMerge';

function row(overrides: Partial<FileScan>): FileScan {
  return {
    id: overrides.id ?? 'scan',
    fileId: '',
    fileBarcode: '',
    filename: 'page.pdf',
    pageNo: 1,
    version: 1,
    documentSize: 'A4',
    status: 'Pending review',
    note: '',
    uploadedAt: '2026-11-20',
    uploadedBy: 'test',
    ...overrides,
  };
}

describe('authoritativeScanRows', () => {
  it('prefers the approved row when a later studio draft shares the page number', () => {
    const pages = [
      row({ id: 'a', pageNo: 1, status: 'Approved' }),
      row({ id: 'b', pageNo: 1, status: 'Pending review' }),
      row({ id: 'c', pageNo: 2, status: 'Approved' }),
    ];
    expect(authoritativeScanRows(pages).map((page) => page.id)).toEqual(['a', 'c']);
  });

  it('takes a newer approved row over an earlier pending-review row for the same number', () => {
    const pages = [
      row({ id: 'a', pageNo: 1, status: 'Pending review' }),
      row({ id: 'b', pageNo: 1, status: 'Approved' }),
    ];
    expect(authoritativeScanRows(pages).map((page) => page.id)).toEqual(['b']);
  });

  it('keeps the latest row when no approved row exists for a page number', () => {
    const pages = [
      row({ id: 'a', pageNo: 1, status: 'Pending review' }),
      row({ id: 'b', pageNo: 1, status: 'Processing' }),
    ];
    expect(authoritativeScanRows(pages).map((page) => page.id)).toEqual(['b']);
  });

  it('keeps pages with distinct page numbers apart, including pageIndex ranges', () => {
    const pages = [
      row({ id: 'a', pageNo: 3, status: 'Approved' }),
      row({ id: 'b', pageNo: 1, pageIndex: 1, status: 'Approved' }),
      row({ id: 'c', pageNo: 2, status: 'Approved' }),
    ];
    expect(authoritativeScanRows(pages).map((page) => page.id)).toEqual(['a', 'b', 'c']);
  });
});
