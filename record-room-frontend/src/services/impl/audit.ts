/**
 * `activity_log_tbl` equivalent plus `login_history` reads.
 *
 * Every mutating service calls `log()` inside the same `store.update()` draft
 * as the change itself, so an audit row can never drift from the data it
 * describes — the transactional guarantee the legacy app lacked.
 */

import { type AuditApi, type AuditQuery } from '../contracts';
import { newId, store, timestamp, type DbShape } from '../store';
import type { AuditAction, AuditEntry, LoginHistoryEntry } from '../../types';
import { session } from './session';

export interface LogInput {
  action: AuditAction;
  entity: string;
  entityId: string;
  before: string;
  after: string;
  summary: string;
}

/** Writes an audit row into an existing draft. Never call outside `update()`. */
export function log(draft: DbShape, input: LogInput) {
  const entry: AuditEntry = {
    id: newId('au'),
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    actor: session.userName(),
    role: session.role(),
    at: timestamp(),
    ip: clientIp(),
    before: input.before,
    after: input.after,
    summary: input.summary,
  };
  draft.audit.unshift(entry);
}

export function clientIp(): string {
  return '127.0.0.1';
}

export function appendLoginHistory(draft: DbShape, entry: Omit<LoginHistoryEntry, 'id'>) {
  draft.loginHistory.unshift({ id: newId('lh'), ...entry });
}

const ACTION_ORDER: AuditAction[] = [
  'Login',
  'Logout',
  'Create',
  'Update',
  'Delete',
  'Issue',
  'Return',
  'Relocate',
  'Approve',
  'Reject',
  'Export',
  'View',
];

/**
 * The audit groups; the entity names are the ones the services write, the same
 * mapping the API applies server-side. Round 4 splits the round-3
 * "logins-issues" group so Logins and Issues are separate tabs (the combined
 * key stays for older links).
 */
const AUDIT_GROUPS: Record<NonNullable<AuditQuery['group']>, string[]> = {
  documents: ['RecordFile', 'MapUpload', 'BulkImportJob', 'BarcodeJob', 'Department'],
  digitization: ['FileScanPage', 'CustodyEvent', 'DocumentDerivative'],
  'logins-issues': ['Session', 'IssueRecord', 'MovementEvent'],
  logins: ['Session'],
  issues: ['IssueRecord', 'MovementEvent'],
};

export const auditService: AuditApi = {
  async list(query: AuditQuery = {}): Promise<AuditEntry[]> {
    const { audit } = store.getState();
    const search = query.search?.trim().toLowerCase() ?? '';
    const groupEntities = query.group ? AUDIT_GROUPS[query.group] : null;
    const filtered = audit.filter((entry) => {
      if (groupEntities && !groupEntities.includes(entry.entity)) return false;
      if (query.action && query.action !== 'All' && entry.action !== query.action) return false;
      if (query.actor && query.actor !== 'All' && entry.actor !== query.actor) return false;
      if (query.entity && entry.entity !== query.entity) return false;
      if (search) {
        const haystack =
          `${entry.summary} ${entry.entity} ${entry.entityId} ${entry.actor} ${entry.ip}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    return filtered.slice(0, query.limit ?? 200);
  },

  async loginHistory(query = {}) {
    const { loginHistory } = store.getState();
    const search = query.search?.trim().toLowerCase() ?? '';
    return loginHistory
      .filter((entry) => {
        if (query.outcome && query.outcome !== 'All' && entry.outcome !== query.outcome)
          return false;
        if (search) {
          const haystack =
            `${entry.userName} ${entry.role} ${entry.ip} ${entry.userAgent} ${entry.detail}`.toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      })
      .slice(0, 250);
  },

  async fileViews(query = {}) {
    const search = query.search?.trim().toLowerCase() ?? '';
    return store
      .getState()
      .audit.filter(
        (entry) =>
          entry.action === 'View' &&
          entry.entity === 'RecordFile' &&
          (!search ||
            `${entry.summary} ${entry.actor} ${entry.entityId}`.toLowerCase().includes(search)),
      )
      .slice(0, query.limit ?? 200);
  },

  async actors() {
    return [...new Set(store.getState().audit.map((entry) => entry.actor))].sort();
  },
};

export const AUDIT_ACTIONS = ACTION_ORDER;

export function auditRowsToCsv(entries: AuditEntry[]) {
  return entries.map((entry) => [
    entry.at,
    entry.action,
    entry.entity,
    entry.entityId,
    entry.actor,
    entry.role,
    entry.ip,
    entry.before,
    entry.after,
    entry.summary,
  ]);
}
