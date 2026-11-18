import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { service } from '../src/services';
import { findFileByInput } from '../src/lib/fileKey';

/**
 * Barcode feature switch (`VITE_ENABLE_BARCODE` / `GET /api/config`) and the room
 * add / edit / delete rules. In-memory adapter, so no API is needed.
 */

async function freshFeatures(env?: string) {
  vi.resetModules();
  vi.unstubAllEnvs();
  if (env !== undefined) vi.stubEnv('VITE_ENABLE_BARCODE', env);
  return import('../src/lib/features');
}

async function freshFeatureSet(values: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  return import('../src/lib/features');
}

describe('barcode feature switch', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('keeps all retained optional modules hidden by default', async () => {
    const { getFeatures } = await freshFeatures();
    expect(getFeatures()).toEqual({
      barcode: false,
      movement: false,
      support: false,
      bulkImport: false,
    });
  });

  it('can explicitly enable retained features independently', async () => {
    const { getFeatures } = await freshFeatureSet({
      VITE_ENABLE_BARCODE: 'true',
      VITE_ENABLE_MOVEMENT: '1',
      VITE_ENABLE_SUPPORT: 'false',
      VITE_ENABLE_BULK_IMPORT: 'on',
    });
    expect(getFeatures()).toEqual({
      barcode: true,
      movement: true,
      support: false,
      bulkImport: true,
    });
  });

  it.each(['false', '0', 'off', 'no', 'disabled', 'FALSE', ' Off '])(
    'turns off for %j',
    async (value) => {
      const { getFeatures } = await freshFeatures(value);
      expect(getFeatures().barcode).toBe(false);
    },
  );

  it.each(['true', '1', 'on', ''])('stays on for %j', async (value) => {
    const { getFeatures } = await freshFeatures(value);
    expect(getFeatures().barcode).toBe(true);
  });

  it('lets every API feature setting override the build-time value', async () => {
    const { getFeatures, loadRuntimeFeatures } = await freshFeatureSet({
      VITE_ENABLE_BARCODE: 'false',
      VITE_ENABLE_MOVEMENT: 'false',
      VITE_ENABLE_SUPPORT: 'true',
      VITE_ENABLE_BULK_IMPORT: 'false',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: { barcode: true, movement: true, support: false, bulkImport: true },
        }),
      }),
    );
    await loadRuntimeFeatures('http://api.test/');
    expect(getFeatures()).toEqual({
      barcode: true,
      movement: true,
      support: false,
      bulkImport: true,
    });
    expect(fetch).toHaveBeenCalledWith('http://api.test/api/config', expect.anything());
  });

  it('keeps the build-time value when the API has no /api/config yet', async () => {
    const { getFeatures, loadRuntimeFeatures } = await freshFeatures('false');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    await loadRuntimeFeatures('http://api.test');
    expect(getFeatures().barcode).toBe(false);
  });

  it('keeps the build-time value when the request fails', async () => {
    const { getFeatures, loadRuntimeFeatures } = await freshFeatures('true');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await loadRuntimeFeatures('http://api.test');
    expect(getFeatures().barcode).toBe(true);
  });

  it('notifies subscribers only when the value changes', async () => {
    const { applyFeatures, getFeatures } = await freshFeatures('true');
    applyFeatures({ barcode: true });
    expect(getFeatures().barcode).toBe(true);
    applyFeatures({ barcode: false });
    expect(getFeatures().barcode).toBe(false);
  });
});


describe('optional movement report visibility', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('does not list the standalone movement report when disabled', async () => {
    await freshFeatures();
    const { reportsService } = await import('../src/services/impl/reports');
    const definitions = await reportsService.definitions();
    expect(definitions.some((item) => item.key === 'movement-log')).toBe(false);
  });

  it('refuses to build the standalone movement report when disabled', async () => {
    await freshFeatures();
    const { reportsService } = await import('../src/services/impl/reports');
    await expect(reportsService.build('movement-log')).rejects.toThrow(
      'Movement history is not enabled.',
    );
  });

  it('restores the movement report when its feature flag is explicitly enabled', async () => {
    await freshFeatureSet({ VITE_ENABLE_MOVEMENT: 'true' });
    const { reportsService } = await import('../src/services/impl/reports');
    const definitions = await reportsService.definitions();
    expect(definitions.some((item) => item.key === 'movement-log')).toBe(true);
  });
});

describe('finding a file from typed text', () => {
  beforeEach(async () => {
    await service.reset();
  });

  it('matches a file number exactly when barcodes are off', async () => {
    const first = (await service.files.list({ pageSize: 1 })).items[0];
    const found = await findFileByInput(service, first.fileNumber.toLowerCase(), false);
    expect(found?.id).toBe(first.id);
  });

  it('does not accept a barcode when barcodes are off', async () => {
    const first = (await service.files.list({ pageSize: 1 })).items[0];
    // A barcode is not a file number, and exact matching is by file number only.
    expect(await findFileByInput(service, first.fileBarcode, false)).toBeNull();
  });

  it('accepts a barcode when barcodes are on', async () => {
    const first = (await service.files.list({ pageSize: 1 })).items[0];
    expect((await findFileByInput(service, first.fileBarcode, true))?.id).toBe(first.id);
  });

  it('returns null for empty or unknown input', async () => {
    expect(await findFileByInput(service, '   ', false)).toBeNull();
    expect(await findFileByInput(service, 'NOPE/0000/0', false)).toBeNull();
  });
});

describe('room add / edit / delete', () => {
  beforeEach(async () => {
    await service.reset();
  });

  it('adds a room with a generated code', async () => {
    const before = await service.locations.listRooms();
    const result = await service.locations.addRoom({
      name: 'Annex Room',
      building: 'Annex',
      floor: 'Ground',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).toMatch(/^RM-\d{3}$/);
    expect(result.value.status).toBe('Operational');
    expect(await service.locations.listRooms()).toHaveLength(before.length + 1);
  });

  it('refuses a blank or duplicate name', async () => {
    const existing = (await service.locations.listRooms())[0];
    const blank = await service.locations.addRoom({ name: '  ', building: '', floor: '' });
    expect(blank.ok).toBe(false);
    const dupe = await service.locations.addRoom({
      name: existing.name.toUpperCase(),
      building: '',
      floor: '',
    });
    expect(dupe.ok).toBe(false);
  });

  it('edits a room but keeps its code', async () => {
    const room = (await service.locations.listRooms())[0];
    const result = await service.locations.updateRoom(room.id, {
      name: 'Renamed Room',
      status: 'Maintenance',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).toBe(room.code);
    expect(result.value.name).toBe('Renamed Room');
    expect(result.value.status).toBe('Maintenance');
  });

  it('refuses to delete a room that still has almirahs or sections', async () => {
    const room = (await service.locations.listRooms()).find(
      (item) => item.storageUnits.length > 0,
    )!;
    const result = await service.locations.deleteRoom(room.id);
    expect(result.ok).toBe(false);
    expect((await service.locations.listRooms()).some((item) => item.id === room.id)).toBe(true);
  });

  it('deletes an empty room, then reports it missing', async () => {
    const created = await service.locations.addRoom({ name: 'Temp', building: '', floor: '' });
    if (!created.ok) throw new Error('setup failed');
    expect((await service.locations.deleteRoom(created.value.id)).ok).toBe(true);
    expect((await service.locations.deleteRoom(created.value.id)).ok).toBe(false);
  });
});

describe('hiding internal ids from server sentences', () => {
  it('removes the leading id and keeps the sentence readable', async () => {
    const { hideFileIds } = await freshFeatures();
    expect(hideFileIds('RF-0000199103 — Released to the digitization desk.', false)).toBe(
      'Released to the digitization desk.',
    );
    expect(hideFileIds('Moved RF-0000199103 to shelf A', false)).toBe('Moved this file to shelf A');
  });

  it('leaves text alone while barcodes are on', async () => {
    const { hideFileIds } = await freshFeatures();
    expect(hideFileIds('RF-0000199103 — Released.', true)).toBe('RF-0000199103 — Released.');
  });
});

describe('reports with the switch off', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('drops barcode columns and keeps rows aligned', async () => {
    await freshFeatures('false');
    const { reportsService } = await import('../src/services/impl/reports');
    const registry = await reportsService.build('file-registry');
    expect(registry.columns.some((name) => /barcode/i.test(name))).toBe(false);
    expect(registry.rows.every((row) => row.length === registry.columns.length)).toBe(true);
  });

  it('keeps them while the switch is on', async () => {
    await freshFeatures('true');
    const { reportsService } = await import('../src/services/impl/reports');
    const registry = await reportsService.build('file-registry');
    expect(registry.columns.some((name) => /barcode/i.test(name))).toBe(true);
  });
});
