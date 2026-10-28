/**
 * Report builders.
 *
 * Each definition points at the legacy controller that produced the equivalent
 * export (`User.php: *ExcelFile/*updatereportexcel*`), so the column set stays
 * traceable. The frontend emits CSV now; the .NET 10 reports worker will serve
 * real `.xlsx` from the same definitions.
 */

import { getFeatures } from '../../lib/features';
import { toCsv, downloadCsv, slugify } from '../../lib/csv';
import { type ReportDefinition, type ReportKey } from '../../types';
import type { ReportResult, ReportsApi } from '../contracts';
import { store, timestamp } from '../store';
import { log } from './audit';

const definitions: ReportDefinition[] = [
  {
    key: 'issue-register',
    title: 'Issue register',
    description: 'Every receipt with its borrower, purpose, due date and open-file count.',
    columns: [
      'Receipt',
      'Issued at',
      'Borrower',
      'Code',
      'Department',
      'Purpose',
      'Due',
      'Status',
      'Files',
    ],
    legacySource: 'Record.php · issue list',
  },
  {
    key: 'return-register',
    title: 'Return register',
    description: 'Receipts with at least one returned file, including the return timestamp.',
    columns: ['Receipt', 'Borrower', 'Returned at', 'Files returned', 'Open files', 'Status'],
    legacySource: 'Record.php · returnfilelist',
  },
  {
    key: 'movement-log',
    title: 'Movement log',
    description: 'Issue, return, relocation and digitization events in reverse chronology.',
    columns: ['At', 'Kind', 'Barcode', 'Subject', 'From', 'To', 'Actor', 'Detail'],
    legacySource: 'activity_log_tbl projection',
  },
  {
    key: 'file-registry',
    title: 'File registry',
    description: 'Registry master data with shelf barcode, location and status.',
    columns: [
      'Barcode',
      'Number',
      'Subject',
      'Department',
      'Year',
      'Status',
      'Shelf',
      'Shelf barcode',
      'Last movement',
    ],
    legacySource: 'File.php · file listing',
  },
  {
    key: 'digitization-progress',
    title: 'Digitization progress',
    description: 'Per-file scan page counts with approval state per file.',
    columns: [
      'FileNumber',
      'Barcode',
      'Department',
      'Year',
      'Pages',
      'Approved',
      'Rejected',
      'Pending',
      'FileStatus',
    ],
    legacySource: 'User.php · uploadservice report',
  },
  {
    key: 'login-history',
    title: 'Login history',
    description: 'Web and mobile sign-in attempts with IP, client and outcome.',
    columns: [
      'Login at',
      'Logout at',
      'User',
      'Role',
      'Channel',
      'IP',
      'Client',
      'Outcome',
      'Detail',
    ],
    legacySource: 'User.php · login_history export',
  },
  {
    key: 'location-occupancy',
    title: 'Location occupancy',
    description: 'Shelf-level occupancy for capacity planning and re-shelving.',
    columns: [
      'Room',
      'Section',
      'Almirah',
      'Shelf',
      'Barcode',
      'Status',
      'Occupied',
      'Capacity',
      'Free',
    ],
    legacySource: 'Store.php · shelf listing',
  },
  {
    key: 'overdue-files',
    title: 'Overdue files',
    description: 'Open receipts past their due date, with the oldest due first.',
    columns: [
      'Receipt',
      'Borrower',
      'Code',
      'Department',
      'Due',
      'Days late',
      'Open files',
      'Issued by',
    ],
    legacySource: 'Employee_reports.php · borrow_list',
  },
];

function daysLate(dueAt: string): number {
  const ms = Date.now() - new Date(dueAt).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** Barcode columns and wording are removed from reports while barcodes are switched off. */
const isBarcodeColumn = (name: string) => /barcode/i.test(name);

function forFeatures(definition: ReportDefinition): ReportDefinition {
  if (getFeatures().barcode) return definition;
  return {
    ...definition,
    columns: definition.columns.filter((name) => !isBarcodeColumn(name)),
    description: definition.description.replace(/ with shelf barcode,/i, ' with'),
  };
}

export const reportsService: ReportsApi = {
  async definitions() {
    // The module-level `definitions` const is still reachable by name here:
    // an object method name is not a binding inside its own body.
    return definitions.map(forFeatures);
  },

  async build(key: ReportKey) {
    const definition = definitions.find((item) => item.key === key);
    if (!definition) throw new Error(`Unknown report "${key}".`);
    const state = store.getState();
    let rows: Array<Array<string | number>> = [];

    switch (key) {
      case 'issue-register':
        rows = state.issues.map((issue) => [
          issue.receiptNumber,
          issue.issuedAt,
          issue.borrowerName,
          issue.borrowerEmployeeCode,
          issue.department,
          issue.purpose,
          issue.dueAt,
          issue.status,
          issue.lines.filter((line) => !line.returnedAt).length,
        ]);
        break;
      case 'return-register':
        rows = state.issues
          .filter((issue) => issue.lines.some((line) => line.returnedAt))
          .map((issue) => [
            issue.receiptNumber,
            issue.borrowerName,
            issue.returnedAt ?? 'partial',
            issue.lines.filter((line) => line.returnedAt).length,
            issue.lines.filter((line) => !line.returnedAt).length,
            issue.status,
          ]);
        break;
      case 'movement-log':
        rows = [...state.movements]
          .sort((a, b) => b.at.localeCompare(a.at))
          .map((event) => [
            event.at,
            event.kind,
            event.fileBarcode,
            event.subject,
            event.from,
            event.to,
            event.actor,
            event.detail,
          ]);
        break;
      case 'file-registry':
        rows = [...state.files]
          .sort((a, b) => a.fileBarcode.localeCompare(b.fileBarcode))
          .map((file) => [
            file.fileBarcode,
            file.fileNumber,
            file.subject,
            file.department,
            file.year,
            file.status,
            file.shelf,
            file.shelfBarcode,
            file.lastMovement,
          ]);
        break;
      case 'digitization-progress':
        rows = state.files
          .filter((file) => state.scanPages.some((page) => page.fileBarcode === file.fileBarcode))
          .map((file) => {
            const pages = state.scanPages.filter((page) => page.fileBarcode === file.fileBarcode);
            return [
              file.fileNumber,
              file.fileBarcode,
              file.department,
              file.year,
              pages.length,
              pages.filter((page) => page.status === 'Approved').length,
              pages.filter((page) => page.status === 'Rejected').length,
              pages.filter((page) => page.status === 'Pending review').length,
              file.status,
            ];
          });
        break;
      case 'login-history':
        rows = state.loginHistory
          .slice()
          .sort((a, b) => b.loginAt.localeCompare(a.loginAt))
          .map((entry) => [
            entry.loginAt,
            entry.logoutAt ?? '—',
            entry.userName,
            entry.role,
            entry.channel,
            entry.ip,
            entry.userAgent,
            entry.outcome,
            entry.detail,
          ]);
        break;
      case 'location-occupancy':
        state.rooms.forEach((room) => {
          room.storageUnits.forEach((unit) => {
            const section = room.sections.find((item) => item.id === unit.sectionId);
            unit.shelves.forEach((shelf) => {
              rows.push([
                room.code,
                section?.name ?? '',
                unit.code,
                shelf.code,
                shelf.barcode,
                shelf.status,
                shelf.occupied,
                shelf.capacity,
                Math.max(0, shelf.capacity - shelf.occupied),
              ]);
            });
          });
        });
        break;
      case 'overdue-files':
        rows = state.issues
          .filter((issue) => issue.status === 'Overdue')
          .map((issue) => [
            issue.receiptNumber,
            issue.borrowerName,
            issue.borrowerEmployeeCode,
            issue.department,
            issue.dueAt,
            daysLate(issue.dueAt),
            issue.lines.filter((line) => !line.returnedAt).length,
            issue.issuedBy,
          ]);
        break;
    }

    if (!getFeatures().barcode) {
      const keep = definition.columns.map((name) => !isBarcodeColumn(name));
      return {
        definition: forFeatures(definition),
        columns: definition.columns.filter((_, index) => keep[index]),
        rows: rows.map((row) => row.filter((_, index) => keep[index])),
        generatedAt: timestamp(),
      };
    }
    return { definition, columns: definition.columns, rows, generatedAt: timestamp() };
  },
};

/** CSV export that also writes the export itself to the audit trail. */
export async function exportReport(key: ReportKey): Promise<ReportResult> {
  const result = await reportsService.build(key);
  const csv = toCsv(result.columns, result.rows);
  downloadCsv(`${slugify(result.definition.title)}-${result.generatedAt.slice(0, 10)}.csv`, csv);
  store.update((draft) => {
    log(draft, {
      action: 'Export',
      entity: 'Report',
      entityId: key,
      before: 'format=csv',
      after: `rows=${result.rows.length}`,
      summary: `${result.definition.title} exported (${result.rows.length} rows)`,
    });
  });
  return result;
}

export type { ReportDefinition, ReportKey };
