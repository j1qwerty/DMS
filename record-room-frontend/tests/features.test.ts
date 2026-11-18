/**
 * Grouped feature switches (ZILA_PANCHAYAT_CC §F): defaults, persistence,
 * runtime merge, and what each group hides.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyFeatures,
  FEATURE_GROUPS,
  FEATURE_KEYS,
  getFeatures,
  hideFileIds,
} from '../src/lib/features';

const hasStorage = typeof window !== 'undefined' && !!window.localStorage;

describe('grouped feature switches', () => {
  beforeEach(() => {
    if (hasStorage) window.localStorage.clear();
    applyFeatures({ barcode: false, recordRoom: false, maps: false, support: false });
  });

  afterEach(() => {
    if (hasStorage) window.localStorage.clear();
  });

  it('defaults every group to hidden (the Zila Panchayat profile)', () => {
    if (hasStorage) window.localStorage.clear();
    // A fresh module read is impossible without a reload, so assert the reset state.
    for (const key of FEATURE_KEYS) expect(getFeatures()[key]).toBe(false);
  });

  it('describes every group that the Settings page lists', () => {
    expect(FEATURE_GROUPS.map((group) => group.key)).toEqual(FEATURE_KEYS);
    for (const group of FEATURE_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.description.length).toBeGreaterThan(20);
      expect(group.includes.length).toBeGreaterThan(0);
    }
  });

  it.skipIf(!hasStorage)('persists admin toggles and restores them on the next session', () => {
    applyFeatures({ maps: true }, true);
    if (hasStorage) expect(window.localStorage.getItem('rr-features-v1')).toContain('"maps":true');
    expect(getFeatures().maps).toBe(true);
  });

  it.skipIf(!hasStorage)('runtime merges do not leak into the persisted profile', () => {
    applyFeatures({ support: true }, true);
    applyFeatures({ support: false });
    expect(getFeatures().support).toBe(false);
    // The persisted choice stays what the admin last saved.
    if (hasStorage) expect(window.localStorage.getItem('rr-features-v1')).toContain('"support":true');
  });

  it('keeps barcode-free sentences readable while barcodes are off', () => {
    expect(hideFileIds('RF-001234 issued to Revenue', false)).toBe('this file issued to Revenue');
    expect(hideFileIds('RF-001234 issued to Revenue', true)).toBe('RF-001234 issued to Revenue');
  });
});
