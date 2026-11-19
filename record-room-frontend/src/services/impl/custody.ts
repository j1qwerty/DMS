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
    const items = rows.slice((page - 1) * pageSize, page * pageSize).map((row) =>
      row.direction === 'Intake'
        ? {
            ...row,
            returnedCount: store
              .getState()
              .custodyEvents.filter(
                (other) => other.sourceCustodyId === row.id && other.direction === 'Return',
              )
              .reduce((sum, other) => sum + other.fileCount, 0),
          }
        : { ...row, returnedCount: 0 },
    );
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
      returnedCount: 0,
      sourceCustodyId: null,
      recordedBy: session.actorName(),
      recordedAt: timestamp(),
      signedOffBy: null,
      signedOffAt: null,
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

  async returnAgainst(id, input) {
    const rows = store.getState().custodyEvents;
    const intake = rows.find((event) => event.id === id);
    if (!intake) return err('Intake event not found.');
    if (intake.direction !== 'Intake') {
      return err('Returns are recorded against an intake batch.', 'sourceCustodyId');
    }
    if (!Number.isFinite(input.fileCount) || input.fileCount < 1) {
      return err('Returned count must be at least 1.', 'fileCount');
    }

    const expected = intake.reconciledCount ?? intake.fileCount;
    const already = rows
      .filter((row) => row.sourceCustodyId === id && row.direction === 'Return')
      .reduce((sum, row) => sum + row.fileCount, 0);
    const remaining = expected - already;

    if (remaining < 1) {
      return err(
        `All ${expected} file(s) of this batch are already recorded as returned.`,
        'fileCount',
      );
    }
    if (input.fileCount > remaining) {
      return err(
        `Only ${remaining} of ${expected} file(s) are still out; the return cannot exceed them.`,
        'fileCount',
      );
    }

    const handover: CustodyEvent = {
      id: newId('custody'),
      direction: 'Return',
      sourceCustodyId: id,
      batchRef: intake.batchRef,
      department: intake.department,
      vendor: '',
      fileCount: input.fileCount,
      returnedCount: 0,
      recordedBy: session.actorName(),
      recordedAt: timestamp(),
      signedOffBy: null,
      signedOffAt: null,
      remarks: input.remarks?.trim() ?? '',
    };
    store.update((draft) => {
      draft.custodyEvents.push(handover);
      log(draft, {
        action: 'Create',
        entity: 'CustodyEvent',
        entityId: handover.id,
        before: '—',
        after: `return · ${intake.department} · ${input.fileCount} of ${remaining} out`,
        summary: `Return of ${input.fileCount} file(s) against the ${intake.department} intake (${input.fileCount + already} of ${expected} back)`,
      });
    });
    return ok(handover);
  },

  async returnsFor(id) {
    // Newest first; ties (same-minute returns) break by insertion order, the
    // same "later rows win" rule the API gets from its identity column.
    return store
      .getState()
      .custodyEvents.filter((row) => row.sourceCustodyId === id)
      .map((row, index) => ({ row, index }))
      .sort((a, b) => b.row.recordedAt.localeCompare(a.row.recordedAt) || b.index - a.index)
      .map((entry) => entry.row);
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
