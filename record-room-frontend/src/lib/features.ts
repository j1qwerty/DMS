import { useSyncExternalStore } from 'react';

/**
 * Grouped feature switches (ZILA_PANCHAYAT_CC §F).
 *
 * The final Zila Panchayat scope does not use these capabilities, so they are
 * hidden — not removed. An Admin turns a group back on at
 * Settings → Feature visibility; enabling a group enables every related
 * surface (sidebar entry, sub-nav tabs, routes, registry columns and the API
 * endpoints behind them, which answer 404 while the group is off).
 *
 * Source of truth, in order:
 *   1. `GET /api/config` from the API (http mode), so a server setting needs no rebuild.
 *   2. `VITE_ENABLE_*` at build time.
 *   3. Off (the Zila Panchayat default).
 *
 * Local-mode toggles persist in localStorage; runtime values from the API do
 * not, so a shared API never leaks its state into a local-mode session.
 */

export type FeatureKey = 'barcode' | 'recordRoom' | 'maps' | 'support';

export interface Features {
  barcode: boolean;
  recordRoom: boolean;
  maps: boolean;
  support: boolean;
}

export const FEATURE_KEYS: FeatureKey[] = ['barcode', 'recordRoom', 'maps', 'support'];

/** Settings-page copy: what each group bundles, so the switch explains itself. */
export const FEATURE_GROUPS: Array<{
  key: FeatureKey;
  label: string;
  description: string;
  includes: string[];
}> = [
  {
    key: 'barcode',
    label: 'Barcode identification',
    description:
      'Barcode-based identification of physical files and locations: the barcode centre, label and QR printing, scan validation, and every on-screen barcode id (files fall back to file numbers).',
    includes: [
      'Barcode centre & print jobs',
      'Scan-a-barcode validation',
      'Barcode columns and inputs',
    ],
  },
  {
    key: 'recordRoom',
    label: 'Rooms & shelves',
    description:
      'Physical storage management: rooms, sections, almirahs and shelves, the layout designer, shelf placement and relocation, and the room/shelf registry filters.',
    includes: [
      'Rooms & shelves pages',
      'Location designer (admin)',
      'Shelf placement & relocation',
    ],
  },
  {
    key: 'maps',
    label: 'Scanned maps & file copies',
    description:
      'Large-format map scans and file copies with version supersession, separate from the file digitization flow.',
    includes: ['Maps page', 'Map uploads & versions'],
  },
  {
    key: 'support',
    label: 'Help & support',
    description: 'The in-app support page with its implementation-inquiry form.',
    includes: ['Help & support page'],
  },
];

const OFF = new Set(['false', '0', 'off', 'no', 'disabled']);
const STORAGE_KEY = 'rr-features-v1';

function parseFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  return !OFF.has(value.trim().toLowerCase());
}

const buildDefaults: Features = {
  barcode: parseFlag(import.meta.env.VITE_ENABLE_BARCODE, false),
  recordRoom: parseFlag(import.meta.env.VITE_ENABLE_RECORD_ROOM, false),
  maps: parseFlag(import.meta.env.VITE_ENABLE_MAPS, false),
  support: parseFlag(import.meta.env.VITE_ENABLE_SUPPORT, false),
};

function readStored(): Partial<Features> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Features>;
    return Object.fromEntries(
      FEATURE_KEYS.filter((key) => typeof parsed[key] === 'boolean').map((key) => [
        key,
        parsed[key],
      ]),
    ) as Partial<Features>;
  } catch {
    return {};
  }
}

let current: Features = { ...buildDefaults, ...readStored() };
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFeatures(): Features {
  return current;
}

/**
 * Merges new values and notifies subscribers. `persist` stores the choice for
 * future local-mode sessions (the Settings toggles); runtime loads from the
 * API pass false so the server is re-asked each boot.
 */
export function applyFeatures(next: Partial<Features>, persist = false): void {
  const merged = { ...current, ...next };
  const changed = FEATURE_KEYS.some((key) => merged[key] !== current[key]);
  if (!changed) return;
  current = merged;
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      /* a full quota loses the toggle, not the session */
    }
  }
  listeners.forEach((listener) => listener());
}

/** Reactive read for components. */
export function useFeatures(): Features {
  return useSyncExternalStore(subscribe, getFeatures, getFeatures);
}

/**
 * Asks the API which feature groups are on. A missing endpoint (older API) or
 * a network error is not a failure: the build-time value simply stays.
 */
export async function loadRuntimeFeatures(baseUrl: string): Promise<void> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/config`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return;
    const body = (await response.json()) as {
      features?: Partial<Record<FeatureKey, unknown>>;
    };
    if (!body.features) return;
    const next: Partial<Features> = {};
    for (const key of FEATURE_KEYS) {
      if (key in body.features) {
        next[key] = parseFlag(body.features[key], current[key]);
      }
    }
    applyFeatures(next);
  } catch {
    /* keep the build-time value */
  }
}

/**
 * Server-written sentences (movement details, activity feed) lead with the
 * file's barcode id. With barcodes off that id is removed so the sentence
 * still reads well.
 */
export function hideFileIds(text: string, barcodeOn: boolean): string {
  if (barcodeOn) return text;
  return text.replace(/\bRF-\d{6,}\s*[—–-]\s*/g, '').replace(/\bRF-\d{6,}\b/g, 'this file');
}
