import { describe, expect, it } from 'vitest';
import {
  changeKindOf,
  formatPageNumbers,
  groupPendingByFile,
} from '../src/lib/reviewGroup';
import type { DocumentDerivative, FileScan, RecordFile } from '../src/types';

function scan(overrides: Partial<FileScan> & { id: string; fileBarcode: string }): FileScan {
  return {
    id: overrides.id,
    fileId: '',
    fileBarcode: overrides.fileBarcode,
    filename: 'page.pdf',
    pageNo: 1,
    version: 1,
    documentSize: 'A4',
    status: 'Pending review',
    note: '',
    uploadedAt: '2026-11-19T10:00:00',
    uploadedBy: 'operator',
    ...overrides,
  } as FileScan;
}

function file(id: string, barcode: string, subject: string): RecordFile {
  return {
    id,
    fileBarcode: barcode,
    rfId: barcode,
    fileNumber: `NUM-${id}`,
    subject,
    department: 'Revenue',
    status: 'Under Digitization',
  } as RecordFile;
}

function derivative(id: string, barcode: string, createdAt: string): DocumentDerivative {
  return {
    id,
    fileId: `f-${barcode}`,
    fileBarcode: barcode,
    kind: 'Pdf',
    filename: 'build.pdf',
    pageCount: 2,
    sourceVersions: '',
    includesOcrText: false,
    createdAt,
    createdBy: 'operator',
    status: 'Pending approval',
  } as DocumentDerivative;
}

describe('changeKindOf', () => {
  it('calls a first version new', () => {
    expect(changeKindOf(scan({ id: 's1', fileBarcode: 'B1' }))).toBe('new');
  });

  it('calls a rescan updated', () => {
    expect(changeKindOf(scan({ id: 's1', fileBarcode: 'B1', version: 2 }))).toBe('updated');
  });

  it('calls a studio import updated even at version 1', () => {
    expect(
      changeKindOf(scan({ id: 's1', fileBarcode: 'B1', note: 'Imported from file_v2.pdf' })),
    ).toBe('updated');
  });
});

describe('formatPageNumbers', () => {
  it('folds consecutive numbers into ranges', () => {
    expect(formatPageNumbers([3, 5, 8, 9, 10])).toBe('3, 5, 8–10');
  });

  it('sorts and dedupes before folding', () => {
    expect(formatPageNumbers([10, 3, 9, 3, 8])).toBe('3, 8–10');
  });

  it('handles single pages and empty input', () => {
    expect(formatPageNumbers([7])).toBe('7');
    expect(formatPageNumbers([])).toBe('');
  });
});

describe('groupPendingByFile', () => {
  const files = [file('f-1', 'B1', 'Land record'), file('f-2', 'B2', 'Pension file')];

  it('groups pending pages and builds of one file into a single row', () => {
    const pages = [
      scan({ id: 's1', fileBarcode: 'B1', fileId: 'f-1', pageNo: 3 }),
      scan({ id: 's2', fileBarcode: 'B1', fileId: 'f-1', pageNo: 4 }),
    ];
    const pdfs = [derivative('d1', 'B1', '2026-11-19T09:00:00')];
    const groups = groupPendingByFile(pages, pdfs, files);
    expect(groups).toHaveLength(1);
    expect(groups[0].fileId).toBe('f-1');
    expect(groups[0].pages).toHaveLength(2);
    expect(groups[0].pdfs).toHaveLength(1);
  });

  it('keeps files separate and sorts by latest activity', () => {
    const pages = [
      scan({ id: 's1', fileBarcode: 'B1', fileId: 'f-1', uploadedAt: '2026-11-19T09:00:00' }),
      scan({ id: 's2', fileBarcode: 'B2', fileId: 'f-2', uploadedAt: '2026-11-19T11:00:00' }),
    ];
    const groups = groupPendingByFile(pages, [], files);
    expect(groups.map((group) => group.fileId)).toEqual(['f-2', 'f-1']);
  });

  it('drops pages whose file left the registry', () => {
    const pages = [scan({ id: 's1', fileBarcode: 'GONE' })];
    expect(groupPendingByFile(pages, [], files)).toHaveLength(0);
  });

  it('orders pages by the studio composition order first', () => {
    const pages = [
      scan({ id: 's1', fileBarcode: 'B1', fileId: 'f-1', pageNo: 1, orderIndex: 3 }),
      scan({ id: 's2', fileBarcode: 'B1', fileId: 'f-1', pageNo: 2, orderIndex: 1 }),
    ];
    const groups = groupPendingByFile(pages, [], files);
    expect(groups[0].pages.map((page) => page.scan.id)).toEqual(['s2', 's1']);
  });
});
