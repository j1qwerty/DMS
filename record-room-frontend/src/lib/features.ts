import { useSyncExternalStore } from 'react';

export interface Features {
  barcode: boolean;
  movement: boolean;
  support: boolean;
  bulkImport: boolean;
}

const OFF = new Set(['false', '0', 'off', 'no', 'disabled']);

function parseFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const text = value.trim().toLowerCase();
  if (OFF.has(text)) return false;
  if (['true', '1', 'on', 'yes', 'enabled'].includes(text)) return true;
  return fallback;
}

let current: Features = {
  barcode: parseFlag(import.meta.env.VITE_ENABLE_BARCODE, false),
  movement: parseFlag(import.meta.env.VITE_ENABLE_MOVEMENT, false),
  support: parseFlag(import.meta.env.VITE_ENABLE_SUPPORT, false),
  bulkImport: parseFlag(import.meta.env.VITE_ENABLE_BULK_IMPORT, false),
};
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFeatures(): Features {
  return current;
}

export function applyFeatures(next: Partial<Features>): void {
  const merged = { ...current, ...next };
  if (
    merged.barcode === current.barcode &&
    merged.movement === current.movement &&
    merged.support === current.support &&
    merged.bulkImport === current.bulkImport
  ) return;
  current = merged;
  listeners.forEach((listener) => listener());
}

export function useFeatures(): Features {
  return useSyncExternalStore(subscribe, getFeatures, getFeatures);
}

/** API configuration is authoritative in HTTP mode; failed requests keep safe build defaults. */
export async function loadRuntimeFeatures(baseUrl: string): Promise<void> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/config`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return;
    const body = (await response.json()) as {
      features?: {
        barcode?: unknown;
        movement?: unknown;
        support?: unknown;
        bulkImport?: unknown;
      };
    };
    const remote = body.features;
    if (!remote) return;
    applyFeatures({
      ...(typeof remote.barcode !== 'undefined' ? { barcode: parseFlag(remote.barcode, current.barcode) } : {}),
      ...(typeof remote.movement !== 'undefined' ? { movement: parseFlag(remote.movement, current.movement) } : {}),
      ...(typeof remote.support !== 'undefined' ? { support: parseFlag(remote.support, current.support) } : {}),
      ...(typeof remote.bulkImport !== 'undefined' ? { bulkImport: parseFlag(remote.bulkImport, current.bulkImport) } : {}),
    });
  } catch {
    /* keep the build-time values */
  }
}

export function hideFileIds(text: string, barcodeOn: boolean): string {
  if (barcodeOn) return text;
  return text.replace(/\bRF-\d{6,}\s*[—–-]\s*/g, '').replace(/\bRF-\d{6,}\b/g, 'this file');
}
