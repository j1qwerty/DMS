import { describe, expect, it } from 'vitest';
import { toDigitalHandoverBatch } from '../src/services/http/map';
import { digitalHandoverService } from '../src/services/impl/digital-handovers';

describe('digital handover DTO mapping', () => {
  it('maps the immutable manifest items and neutral receiver sign-off fields', () => {
    const batch = toDigitalHandoverBatch({
      id: 12,
      batchRef: 'ZP-DIG-2026-001',
      department: 'Establishment',
      notes: 'Pilot package',
      status: 'Rejected',
      manifestSha256: 'A'.repeat(64),
      itemCount: 1,
      preparedBy: 'Admin',
      preparedAt: '2026-11-18T09:00:00Z',
      deliveredBy: 'Supervisor',
      deliveredAt: '2026-11-18T10:00:00Z',
      signedOffBy: 'Department Nodal Officer',
      signedOffAt: '2026-11-18T11:00:00Z',
      decisionNotes: 'One PDF was incomplete.',
      items: [
        {
          id: 5,
          fileId: 101,
          documentId: 202,
          fileNumber: 'ZP/EST/2026/001',
          department: 'Establishment',
          fileName: 'ZP-001-final.pdf',
          version: 3,
          contentType: 'application/pdf',
          sizeBytes: 4096,
          pageCount: 12,
          sha256: 'B'.repeat(64),
        },
      ],
    });

    expect(batch.id).toBe('12');
    expect(batch.status).toBe('Rejected');
    expect(batch.signedOffBy).toBe('Department Nodal Officer');
    expect(batch.signedOffAt).toBe('2026-11-18T11:00:00Z');
    expect(batch.manifestSha256).toBe('A'.repeat(64));
    expect(batch.items).toEqual([
      {
        id: '5',
        fileId: '101',
        documentId: '202',
        fileNumber: 'ZP/EST/2026/001',
        department: 'Establishment',
        filename: 'ZP-001-final.pdf',
        version: 3,
        contentType: 'application/pdf',
        sizeBytes: 4096,
        pageCount: 12,
        sha256: 'B'.repeat(64),
      },
    ]);
  });

  it('maps an empty handover manifest without assuming items are present', () => {
    const batch = toDigitalHandoverBatch({
      id: 13,
      batchRef: 'ZP-DIG-EMPTY',
      department: 'Revenue',
      status: 'Prepared',
      items: null,
    });

    expect(batch.items).toEqual([]);
    expect(batch.itemCount).toBe(0);
    expect(batch.signedOffBy).toBeNull();
  });
});

describe('local digital handover adapter', () => {
  it('does not simulate an official handover in the in-memory demo', async () => {
    expect(await digitalHandoverService.list()).toEqual([]);

    const result = await digitalHandoverService.prepare({
      batchRef: 'LOCAL-DEMO',
      department: 'Establishment',
      fileIds: [1],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/SQL Server API/i);
    }
  });

  it('does not allow a local demo to fabricate delivery or Department sign-off', async () => {
    const delivered = await digitalHandoverService.markDelivered('1');
    const signedOff = await digitalHandoverService.signOff(
      '1',
      'Accepted',
      'Department Officer',
    );

    expect(delivered.ok).toBe(false);
    expect(signedOff.ok).toBe(false);
    await expect(digitalHandoverService.packageBlob('1')).rejects.toThrow(/SQL Server API/i);
  });
});
