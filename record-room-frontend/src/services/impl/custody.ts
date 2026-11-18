/**
 * The digitization custody chain (work plan §3.8): an intake register ("In" —
 * a department's files received and counted) and a return / handover sign-off
 * ("Out"). Mirrors `dotnet-api` `CustodyService`: rows are immutable —
 * corrections are new events, never edits — and every write is audit-logged.
 */

import { err, ok, type CustodyApi, type Page } from '../contracts';
import { newId, store, timestamp } from '../store';
import type { CustodyDirection, CustodyEvent } from '../../types';
import { log } from './audit';
import { session } from './session';

const PAGE_DEFAULT = 20;

function matches(row: CustodyEvent, needle: string): boolean {
  return (
    row.department.toLowerCase().includes(needle) ||
    row.batchRef.toLowerCase().includes(needle) ||
    row.vendor.toLowerCase().includes(needle) ||
    row.recordedBy.toLowerCase().includes(needle) ||
    row.remarks.toLowerCase().includes(needle)
  );
}

export const custodyService: CustodyApi = {
  async list(query) {
    const direction = query?.direction;
    const search = query?.search?.trim().toLowerCase() ?? '';
    const rows = store
      .getState()
      .custodyEvents.filter(
        (row) =>
          (!direction || direction === 'All' || row.direction === direction) &&
          (search.length === 0 || matches(row, search)),
      )
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id));

    const page = Math.max(query?.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query?.pageSize ?? PAGE_DEFAULT, 1), 100);
    const returnCounts = new Map<string, number>();
    for (const row of rows) {
      if (row.parentEventId) {
        returnCounts.set(row.parentEventId, (returnCounts.get(row.parentEventId) ?? 0) + row.fileCount);
      }
    }
    const withReturnTotals = rows.map((row) => ({
      ...row,
      returnedCount: returnCounts.get(row.id) ?? (row.parentEventId ? row.fileCount : 0),
      remainingCount: row.direction === 'Intake'
        ? Math.max(0, (row.reconciledCount ?? 0) - (returnCounts.get(row.id) ?? 0))
        : 0,
    }));
    const items = withReturnTotals.slice((page - 1) * pageSize, page * pageSize);
    const result: Page<CustodyEvent> = {
      items,
      total: rows.length,
      page,
      pageSize,
      collectionTotal: rows.length,
    };
    return result;
  },

  async record(input) {
    const department = input.department.trim();
    if (department.length === 0) return err('Department is required.', 'department');
    if (!Number.isFinite(input.fileCount) || input.fileCount < 1) {
      return err('File count must be at least 1.', 'fileCount');
    }
    if (input.direction !== 'Intake' && input.direction !== 'Return') {
      return err('Direction must be Intake or Return.', 'direction');
    }

    const event: CustodyEvent = {
      id: newId('custody'),
      direction: input.direction as CustodyDirection,
      batchRef: input.batchRef?.trim() ?? '',
      department,
      vendor: input.vendor?.trim() ?? '',
      fileCount: input.fileCount,
      recordedBy: session.actorName(),
      recordedAt: timestamp(),
      signedOffBy: null,
      signedOffAt: null,
      reconciledBy: input.direction === 'Return' ? session.actorName() : null,
      reconciledAt: input.direction === 'Return' ? timestamp() : null,
      returnedCount: 0,
      remainingCount: 0,
      remarks: input.remarks?.trim() ?? '',
    };
    store.update((draft) => {
      draft.custodyEvents.push(event);
      log(draft, {
        action: 'Create',
        entity: 'CustodyEvent',
        entityId: event.id,
        before: '—',
        after: `${event.direction} · ${department} · ${input.fileCount} file(s)`,
        summary: `${event.direction} of ${input.fileCount} file(s) for ${department} recorded`,
      });
    });
    return ok(event);
  },

  async reconcile(id, reconciledCount, remarks) {
    const row = store.getState().custodyEvents.find((event) => event.id === id);
    if (!row) return err('Custody event not found.');
    // Counting is the intake step; a return closes by sign-off, not a recount.
    if (row.direction !== 'Intake') {
      return err('Only intake events are counted; returns close by sign-off.');
    }
    if (row.signedOffAt) {
      return err('This event is already signed off and can no longer be changed.');
    }
    if (!Number.isFinite(reconciledCount) || reconciledCount < 0) {
      return err('Reconciled count cannot be negative.', 'reconciledCount');
    }

    const before = `counted ${row.reconciledCount ?? 'not yet'}`;
    store.update((draft) => {
      const event = draft.custodyEvents.find((item) => item.id === id);
      if (!event) return;
      event.reconciledCount = reconciledCount;
      event.reconciledBy = session.actorName();
      event.reconciledAt = timestamp();
      if (remarks?.trim()) event.remarks = remarks.trim();
      log(draft, {
        action: 'Update',
        entity: 'CustodyEvent',
        entityId: id,
        before,
        after: `counted ${reconciledCount}`,
        summary: `Intake for ${event.department} reconciled: declared ${event.fileCount}, counted ${reconciledCount}.`,
      });
    });
    const updated = store.getState().custodyEvents.find((event) => event.id === id);
    return updated ? ok(updated) : err('Custody event not found.');
  },

  async recordReturn(id, input) {
    const intake = store.getState().custodyEvents.find((event) => event.id === id);
    if (!intake) return err('Intake event not found.');
    if (intake.direction !== 'Intake') return err('Returns must be recorded against an intake event.');
    if (!intake.signedOffAt || intake.reconciledCount == null) return err('Count and sign off the intake before recording its return.');
    if (!Number.isFinite(input.fileCount) || input.fileCount < 1) return err('Return count must be at least 1.', 'fileCount');
    const returned = store.getState().custodyEvents
      .filter((event) => event.parentEventId === id)
      .reduce((total, event) => total + event.fileCount, 0);
    const remaining = intake.reconciledCount - returned;
    if (input.fileCount > remaining) return err(`Only ${remaining} file(s) remain to be returned.`, 'fileCount');
    const actor = session.actorName();
    const now = timestamp();
    const event: CustodyEvent = {
      id: newId('custody'),
      direction: 'Return',
      parentEventId: intake.id,
      batchRef: intake.batchRef,
      department: intake.department,
      vendor: intake.vendor,
      fileCount: input.fileCount,
      reconciledCount: input.fileCount,
      reconciledBy: actor,
      reconciledAt: now,
      recordedBy: actor,
      recordedAt: now,
      signedOffBy: input.signedOffBy?.trim() || actor,
      signedOffAt: now,
      returnedCount: input.fileCount,
      remainingCount: 0,
      remarks: input.remarks?.trim() ?? '',
    };
    store.update((draft) => {
      draft.custodyEvents.push(event);
      log(draft, {
        action: 'Create',
        entity: 'CustodyEvent',
        entityId: event.id,
        before: '—',
        after: `Return · ${intake.batchRef} · ${input.fileCount} file(s)`,
        summary: `Return of ${input.fileCount} file(s) against intake ${intake.id} recorded and signed off.`,
      });
    });
    return ok(event);
  },

  async signOff(id, signedOffBy) {
    const row = store.getState().custodyEvents.find((event) => event.id === id);
    if (!row) return err('Custody event not found.');
    if (row.signedOffAt) return err('This event is already signed off.');

    const signer = signedOffBy?.trim() || session.actorName();
    store.update((draft) => {
      const event = draft.custodyEvents.find((item) => item.id === id);
      if (!event) return;
      event.signedOffBy = signer;
      event.signedOffAt = timestamp();
      log(draft, {
        action: 'Approve',
        entity: 'CustodyEvent',
        entityId: id,
        before: 'not signed off',
        after: `signed off by ${signer}`,
        summary: `${event.direction} for ${event.department} signed off by ${signer}.`,
      });
    });
    const updated = store.getState().custodyEvents.find((event) => event.id === id);
    return updated ? ok(updated) : err('Custody event not found.');
  },
};
