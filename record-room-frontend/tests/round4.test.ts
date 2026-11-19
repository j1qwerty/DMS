import { beforeEach, describe, expect, it } from 'vitest';
import { service } from '../src/services';
import { auditService } from '../src/services/impl/audit';
import { custodyService } from '../src/services/impl/custody';
import { filesService } from '../src/services/impl/files';
import { scansService } from '../src/services/impl/scans';
import { session } from '../src/services/impl/session';

/**
 * Round-4 behaviour on the in-memory adapter: the session actor fix (a
 * refresh-restored session must never write "system" on custody rows), the
 * split audit groups (logins / issues), and the deliverable-PDF review flow
 * (build → pending approval → approve/reject, history kept). The same rules
 * are asserted over real HTTP + SQL Server by dotnet-api/scripts/test-api.ps1
 * and the API flow tests in tests/RecordRoom.Api.Tests.
 */

const SESSION_USER = {
  id: 'user-round4',
  userName: 'r4supervisor',
  displayName: 'Round Four Supervisor',
  role: 'Supervisor',
};

/** Minimal localStorage so the storage path is exercised in the node env (as in session-snapshot.test.ts). */
function withStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    },
  });
  return map;
}

beforeEach(async () => {
  await service.reset();
  session.set(null);
  withStorage();
});

/**
 * Writes the session the way a page refresh leaves it: in localStorage, with
 * the module-level `current` untouched — which is exactly the state that used
 * to make every actor read as "system" (round-4 bug).
 */
function hydrateSessionFromStorage() {
  withStorage({ 'rr-session': JSON.stringify(SESSION_USER) });
}

describe('the session actor after a refresh', () => {
  it('reads actorName from the restored session, not "system"', () => {
    hydrateSessionFromStorage();
    expect(session.actorName()).toBe(SESSION_USER.displayName);
    expect(session.userName()).toBe(SESSION_USER.userName);
    expect(session.role()).toBe('Supervisor');
  });

  it('records custody intake under the signed-in user after a refresh', async () => {
    hydrateSessionFromStorage();

    const intake = await custodyService.record({
      direction: 'Intake',
      department: 'Revenue',
      fileCount: 5,
      batchRef: 'DIG-R4-1000',
    });
    expect(intake.ok).toBe(true);
    if (intake.ok) expect(intake.value.recordedBy).toBe(SESSION_USER.displayName);

    // And the return recorded against that intake carries the same actor —
    // the register's "by system" line is gone.
    const back = await custodyService.returnAgainst(intake.ok ? intake.value.id : '', {
      fileCount: 2,
    });
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.value.recordedBy).toBe(SESSION_USER.displayName);
  });

  it('writes audit rows under the restored session user', async () => {
    hydrateSessionFromStorage();

    const intake = await custodyService.record({
      direction: 'Intake',
      department: 'Revenue',
      fileCount: 3,
    });
    expect(intake.ok).toBe(true);

    const rows = await auditService.list({ group: 'digitization' });
    const actor = new Set(rows.map((row) => row.actor));
    expect(actor.has(SESSION_USER.userName)).toBe(true);
    expect(actor.has('system')).toBe(false);
  });
});

describe('the split audit groups', () => {
  it('logins group carries session entities only', async () => {
    const rows = await auditService.list({ group: 'logins' });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.entity === 'Session')).toBe(true);
  });

  it('issues group carries the issue / return / movement trail', async () => {
    const rows = await auditService.list({ group: 'issues' });
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every((row) => row.entity === 'IssueRecord' || row.entity === 'MovementEvent'),
    ).toBe(true);
  });

  it('keeps the combined logins-issues key working for older links', async () => {
    const combined = await auditService.list({ group: 'logins-issues' });
    const logins = await auditService.list({ group: 'logins' });
    const issues = await auditService.list({ group: 'issues' });
    expect(combined.length).toBe(logins.length + issues.length);
  });
});

describe('the deliverable-PDF review flow', () => {
  async function fileForFlow() {
    const page = await filesService.list({ pageSize: 1 });
    const file = page.items[0];
    if (!file) throw new Error('the seed registry is empty');
    return file;
  }

  async function approvedPageWithDocument(fileId: string, barcode: string, pageNo: number) {
    const added = await scansService.add(fileId, {
      pageNo,
      filename: `round4-page-${pageNo}.png`,
      documentSize: 'A4',
    });
    if (!added.ok) throw new Error(added.error);

    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ]);
    const withDoc = await scansService.addDocument(
      added.value.id,
      new File([bytes], `round4-page-${pageNo}.png`, { type: 'image/png' }),
    );
    if (!withDoc.ok) throw new Error(withDoc.error);

    const reviewed = await scansService.review(added.value.id, 'Approved', '');
    if (!reviewed.ok) throw new Error(reviewed.error);
    return reviewed.value;
  }

  it('a fresh build is pending approval, then the reviewer signs off', async () => {
    hydrateSessionFromStorage();
    const file = await fileForFlow();
    await approvedPageWithDocument(file.id, file.fileBarcode, 901);

    const built = await scansService.buildPdf(file.id, 'round4-deliverable.pdf');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.status).toBe('Pending approval');
    expect(built.value.pageCount).toBe(1);
    expect(built.value.reviewedBy).toBeUndefined();

    // A rejection without a reason is refused.
    const noReason = await scansService.reviewPdf(built.value.id, 'Rejected');
    expect(noReason.ok).toBe(false);

    const approved = await scansService.reviewPdf(built.value.id, 'Approved');
    expect(approved.ok).toBe(true);
    if (approved.ok) {
      expect(approved.value.status).toBe('Approved');
      expect(approved.value.reviewedBy).toBe(SESSION_USER.displayName);
    }

    // A reviewed build cannot be reviewed again.
    const again = await scansService.reviewPdf(built.value.id, 'Rejected', 'changed my mind');
    expect(again.ok).toBe(false);

    const history = await scansService.listPdfs(file.id);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('Approved');
  });

  it('keeps every build in the history, rejected or approved', async () => {
    hydrateSessionFromStorage();
    const file = await fileForFlow();
    await approvedPageWithDocument(file.id, file.fileBarcode, 911);

    const first = await scansService.buildPdf(file.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const rejected = await scansService.reviewPdf(first.value.id, 'Rejected', 'wrong page order');
    expect(rejected.ok).toBe(true);

    await approvedPageWithDocument(file.id, file.fileBarcode, 912);
    const second = await scansService.buildPdf(file.id);
    expect(second.ok).toBe(true);

    const history = await scansService.listPdfs(file.id);
    expect(history).toHaveLength(2);
    expect(history[0].status).toBe('Pending approval'); // newest first
    expect(history[1].status).toBe('Rejected');
    expect(history[1].reviewNote).toBe('wrong page order');

    // Both builds' bytes still download — the history is not metadata-only.
    for (const item of history) {
      const blob = await scansService.pdfBlob(item.id);
      expect(blob.size).toBeGreaterThan(0);
    }
  });

  it('refuses to build without an approved page', async () => {
    const file = await fileForFlow();
    const built = await scansService.buildPdf(file.id, 'nothing-here.pdf');
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error).toMatch(/approve pages/i);
  });
});

describe('the digitization queue rows carry their document', () => {
  it('shows the uploaded scan in the pending queue with hasDocument', async () => {
    const page = await filesService.list({ pageSize: 1 });
    const file = page.items[0];
    if (!file) throw new Error('the seed registry is empty');

    const added = await scansService.add(file.id, {
      pageNo: 921,
      filename: 'round4-queue-page.png',
      documentSize: 'A4',
    });
    expect(added.ok).toBe(true);

    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(
      (
        await scansService.addDocument(
          added.value.id,
          new File([bytes], 'p.png', { type: 'image/png' }),
        )
      ).ok,
    ).toBe(true);

    const queue = await scansService.pending({});
    const row = queue.find((item) => item.id === added.value.id);
    expect(row).toBeDefined();
    expect(row?.hasDocument).toBe(true);
    expect(row?.fileId).toBe(file.id);

    // The preview path can really fetch the bytes.
    const blob = await scansService.scanBlob(added.value.id);
    expect(blob.size).toBe(bytes.byteLength);
  });
});
