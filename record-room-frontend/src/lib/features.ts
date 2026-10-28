import { useSyncExternalStore } from 'react';

/**
 * Optional feature switches.
 *
 * `barcode` turns barcode-based identification of physical files and locations on or
 * off. It is ON by default. It only affects the record-room section: the issue,
 * return, movement and room screens stay, but scanning, label printing and every
 * on-screen barcode value go away, and files are identified by file number instead.
 *
 * Source of truth, in order:
 *   1. `GET /api/config` from the API (http mode), so a server setting needs no rebuild.
 *   2. `VITE_ENABLE_BARCODE` at build time (also the only source in local mode).
 *   3. On.
 *
 * See `.env.example` for the exact list of what is hidden on which page.
 */
export interface Features {
  barcode: boolean;
}

const OFF = new Set(['false', '0', 'off', 'no', 'disabled']);

function parseFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  return !OFF.has(value.trim().toLowerCase());
}

let current: Features = { barcode: parseFlag(import.meta.env.VITE_ENABLE_BARCODE, true) };
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
  if (merged.barcode === current.barcode) return;
  current = merged;
  listeners.forEach((listener) => listener());
}

/** Reactive read for components. */
export function useFeatures(): Features {
  return useSyncExternalStore(subscribe, getFeatures, getFeatures);
}

/**
 * Asks the API which features are on. A missing endpoint (older API) or a network
 * error is not a failure: the build-time value simply stays.
 */
export async function loadRuntimeFeatures(baseUrl: string): Promise<void> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/config`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return;
    const body = (await response.json()) as { features?: { barcode?: unknown } };
    if (body.features && 'barcode' in body.features) {
      applyFeatures({ barcode: parseFlag(body.features.barcode, current.barcode) });
    }
  } catch {
    /* keep the build-time value */
  }
}

/**
 * Server-written sentences (movement details, activity feed) lead with the file's
 * barcode id. With barcodes off that id is removed so the sentence still reads well.
 */
export function hideFileIds(text: string, barcodeOn: boolean): string {
  if (barcodeOn) return text;
  return text.replace(/\bRF-\d{6,}\s*[—–-]\s*/g, '').replace(/\bRF-\d{6,}\b/g, 'this file');
}
