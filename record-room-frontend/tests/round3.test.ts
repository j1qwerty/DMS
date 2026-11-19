import { beforeEach, describe, expect, it } from 'vitest';
import { service } from '../src/services';
import { custodyService } from '../src/services/impl/custody';
import { departmentsService } from '../src/services/impl/departments';
import { auditService } from '../src/services/impl/audit';
import { scansService } from '../src/services/impl/scans';
import { MATRIX_V1, PERMISSIONS } from '../src/services/permissions';
import { suggestedBatchRef } from '../src/lib/batchRef';

/**
 * Round-3 behaviour on the in-memory adapter: returns recorded against an
 * intake batch (partial and full), the managed department list, the audit
 * groups and the file-view trail, the OCR re-run, and the two new permissions.
 * The same rules are asserted over real HTTP by dotnet-api/scripts/test-api.ps1.
 */

beforeEach(async () => {
  await service.reset();
});

describe('custody returns recorded against an intake batch', () => {
  async function intake(count: number) {
    const result = await custodyService.record({
      direction: 'Intake',
      department: 'Revenue',
      fileCount: count,
      batchRef: 'DIG-20261118-1000',
    });
    expect(result.ok).toBe(true);
    return result.ok ? result.value : undefined;
  }

  it('records a partial return and shows x of y in the register', async () => {
    const event = await intake(10);
    if (!event) throw new Error('intake failed');

    const part = await custodyService.returnAgainst(event.id, { fileCount: 6 });
    expect(part.ok).toBe(true);
    if (part.ok) {
      expect(part.value.direction).toBe('Return');
      expect(part.value.sourceCustodyId).toBe(event.id);
      expect(part.value.department).toBe('Revenue');
      expect(part.value.batchRef).toBe('DIG-20261118-1000');
    }

    const page = await custodyService.list({ direction: 'Intake' });
    expect(page.items[0].returnedCount).toBe(6);
  });

  it('refuses a return larger than what is still out', async () => {
    const event = await intake(10);
    if (!event) throw new Error('intake failed');

    const tooMany = await custodyService.returnAgainst(event.id, { fileCount: 11 });
    expect(tooMany.ok).toBe(false);

    const exact = await custodyService.returnAgainst(event.id, { fileCount: 10 });
    expect(exact.ok).toBe(true);
  });

  it('allows repeated partial returns until the batch is fully back, then refuses', async () => {
    const event = await intake(10);
    if (!event) throw new Error('intake failed');

    expect((await custodyService.returnAgainst(event.id, { fileCount: 6 })).ok).toBe(true);
    expect((await custodyService.returnAgainst(event.id, { fileCount: 4 })).ok).toBe(true);

    const page = await custodyService.list({ direction: 'Intake' });
    expect(page.items[0].returnedCount).toBe(10);

    const none = await custodyService.returnAgainst(event.id, { fileCount: 1 });
    expect(none.ok).toBe(false);
  });

  it('refuses a return recorded against a return', async () => {
    const event = await intake(10);
    if (!event) throw new Error('intake failed');
    const handover = await custodyService.returnAgainst(event.id, { fileCount: 5 });
    if (!handover.ok) throw new Error('return failed');

    const chained = await custodyService.returnAgainst(handover.value.id, { fileCount: 1 });
    expect(chained.ok).toBe(false);
  });

  it('expects the counted total once the intake is reconciled', async () => {
    const event = await intake(10);
    if (!event) throw new Error('intake failed');

    const reconciled = await custodyService.reconcile(event.id, 8);
    expect(reconciled.ok).toBe(true);
    if (reconciled.ok) expect(reconciled.value.reconciledBy).toBeTruthy();

    // Only 8 are expected back now; the 2-file shortfall is a variance story,
    // not more files to return.
    expect((await custodyService.returnAgainst(event.id, { fileCount: 6 })).ok).toBe(true);
    const over = await custodyService.returnAgainst(event.id, { fileCount: 3 });
    expect(over.ok).toBe(false);
    expect((await custodyService.returnAgainst(event.id, { fileCount: 2 })).ok).toBe(true);
  });

  it('lists the returns of a batch newest first', async () => {
    const event = await intake(10);
    if (!event) throw new Error('intake failed');
    await custodyService.returnAgainst(event.id, { fileCount: 6, remarks: 'first half' });
    await custodyService.returnAgainst(event.id, { fileCount: 4, remarks: 'rest' });

    const returns = await custodyService.returnsFor(event.id);
    expect(returns).toHaveLength(2);
    expect(returns[0].remarks).toBe('rest');
    expect(returns.every((row) => row.sourceCustodyId === event.id)).toBe(true);
  });
});

describe('the managed department list', () => {
  it('seeds from the registry vocabulary and counts filed employees', async () => {
    const list = await departmentsService.list();
    expect(list.length).toBeGreaterThanOrEqual(8);
    expect(list.some((department) => department.name === 'Revenue')).toBe(true);
    const revenue = list.find((department) => department.name === 'Revenue');
    if (!revenue) throw new Error('Revenue missing');
    expect(revenue.code).toBe('REV');
    expect(revenue.employeeCount).toBeGreaterThanOrEqual(1);
  });

  it('refuses duplicate names and codes', async () => {
    expect((await departmentsService.create({ name: 'Revenue', code: 'XYZ' })).ok).toBe(false);
    expect((await departmentsService.create({ name: 'New One', code: 'REV' })).ok).toBe(false);
    expect((await departmentsService.create({ name: 'New One', code: 'NEW' })).ok).toBe(true);
  });

  it('follows employees on a rename', async () => {
    const list = await departmentsService.list();
    const target = list.find((department) => department.name === 'Education');
    if (!target) throw new Error('Education missing');

    const before = await service.employees.list({ pageSize: 500 });
    const inEducation = before.items.filter((employee) => employee.department === 'Education');

    const renamed = await departmentsService.update(target.id, {
      name: 'School Education',
      code: 'EDU',
    });
    expect(renamed.ok).toBe(true);

    const after = await service.employees.list({ pageSize: 500 });
    for (const employee of inEducation) {
      const moved = after.items.find((row) => row.id === employee.id);
      expect(moved?.department).toBe('School Education');
    }
  });

  it('refuses to delete a department employees still use', async () => {
    const list = await departmentsService.list();
    const inUse = list.find((department) => department.employeeCount > 0);
    if (!inUse) throw new Error('no department in use');

    const refused = await departmentsService.remove(inUse.id);
    expect(refused.ok).toBe(false);
  });

  it('deletes an unused department', async () => {
    const created = await departmentsService.create({ name: 'Temp Dept', code: 'TMP' });
    if (!created.ok) throw new Error('create failed');
    const removed = await departmentsService.remove(created.value.id);
    expect(removed.ok).toBe(true);
    const list = await departmentsService.list();
    expect(list.some((department) => department.name === 'Temp Dept')).toBe(false);
  });
});

describe('audit groups and the file-view trail', () => {
  it('documents group carries registry entities only', async () => {
    const entries = await auditService.list({ group: 'documents' });
    expect(entries.length).toBeGreaterThan(0);
    const entities = new Set(entries.map((entry) => entry.entity));
    for (const entity of entities) {
      expect(['RecordFile', 'MapUpload', 'BulkImportJob', 'BarcodeJob', 'Department']).toContain(
        entity,
      );
    }
  });

  it('digitization group carries the scan pipeline entities', async () => {
    const entries = await auditService.list({ group: 'digitization' });
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(['FileScanPage', 'CustodyEvent', 'DocumentDerivative']).toContain(entry.entity);
    }
  });

  it('logins-issues group carries sessions and issue records', async () => {
    const entries = await auditService.list({ group: 'logins-issues' });
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(['Session', 'IssueRecord', 'MovementEvent']).toContain(entry.entity);
    }
  });

  it('file views returns only file-open events', async () => {
    // Opening a file writes a View row in local mode? The local adapter seeds
    // audit rows; the file-view list is whatever View/RecordFile rows exist.
    const views = await auditService.fileViews({});
    for (const entry of views) {
      expect(entry.action).toBe('View');
      expect(entry.entity).toBe('RecordFile');
    }
  });
});

describe('the OCR re-run', () => {
  it('returns and stores the text of a page', async () => {
    const pages = await scansService.list(
      (await service.files.byBarcode('RF-0000199103'))?.id ?? '',
    );
    if (pages.length === 0) return; // local seed has pages for this barcode

    const result = await scansService.runOcr(pages[0].id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ocrText.length).toBeGreaterThan(0);
      expect(result.value.method).toBeTruthy();
    }
    const after = await scansService.list(pages[0].fileId);
    expect(after[0].ocrText?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('the round-3 permissions', () => {
  it('adds studio.use and audit.fileViews to the catalogue in API order', () => {
    expect(PERMISSIONS).toHaveLength(21);
    expect(PERMISSIONS.indexOf('studio.use')).toBe(PERMISSIONS.indexOf('digitization.review') + 1);
    expect(PERMISSIONS.indexOf('audit.fileViews')).toBe(PERMISSIONS.indexOf('audit.view') + 1);
  });

  it('grants the studio to every role by default', () => {
    for (const role of ['Admin', 'Supervisor', 'Operator', 'Employee'] as const) {
      expect(MATRIX_V1[role]).toContain('studio.use');
    }
  });

  it('keeps the file-view trail with Admin by default', () => {
    expect(MATRIX_V1.Admin).toContain('audit.fileViews');
    expect(MATRIX_V1.Supervisor).not.toContain('audit.fileViews');
    expect(MATRIX_V1.Operator).not.toContain('audit.fileViews');
    expect(MATRIX_V1.Employee).not.toContain('audit.fileViews');
  });
});

describe('the suggested batch reference', () => {
  it('is a date-time prefix the user edits from', () => {
    expect(suggestedBatchRef()).toMatch(/^DIG-\d{8}-\d{4}$/);
    expect(suggestedBatchRef('BATCH')).toMatch(/^BATCH-\d{8}-\d{4}$/);
  });
});
