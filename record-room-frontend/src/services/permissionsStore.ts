/**
 * Runtime store behind `can()` (design doc V2-EDITABLE-PERMISSIONS §5).
 *
 * `can()` is called synchronously in 16 files, so the editable matrix lives
 * behind a synchronous external store: seeded from the v1 lists (first paint
 * identical to the static build), replaceable after an admin edit or when the
 * API's matrix arrives. Local-mode edits persist in localStorage.
 */

import type { Role } from '../types';
import {
  MATRIX_V1,
  type Permission,
  type RolePermissionMatrix,
  PERMISSIONS,
} from './permissions-matrix';

export type { RolePermissionMatrix };
export { MATRIX_V1 };
export type { Permission };

const STORAGE_KEY = 'rr-perm-matrix-v1';

function readStored(): RolePermissionMatrix | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RolePermissionMatrix;
    const roles: Role[] = ['Admin', 'Supervisor', 'Operator', 'Employee'];
    if (!roles.every((role) => Array.isArray(parsed[role]))) return null;

    // Admin is fixed and permanently holds the full compile-time catalogue.
    parsed.Admin = PERMISSIONS;

    // If an older cache predates studio.use (no role has it), backfill default grants.
    const anyRoleHasStudio = roles.some((r) => parsed[r]?.includes('studio.use'));
    if (!anyRoleHasStudio) {
      for (const r of roles) {
        if (MATRIX_V1[r].includes('studio.use') && !parsed[r].includes('studio.use')) {
          parsed[r] = [...parsed[r], 'studio.use'];
        }
      }
    }

    // Same safeguard for audit.fileViews.
    const anyRoleHasFileViews = roles.some((r) => parsed[r]?.includes('audit.fileViews'));
    if (!anyRoleHasFileViews) {
      for (const r of roles) {
        if (MATRIX_V1[r].includes('audit.fileViews') && !parsed[r].includes('audit.fileViews')) {
          parsed[r] = [...parsed[r], 'audit.fileViews'];
        }
      }
    }

    return parsed;
  } catch {
    return null;
  }
}

let snapshot: RolePermissionMatrix = readStored() ?? MATRIX_V1;
const listeners = new Set<() => void>();

export const permissionsStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get(): RolePermissionMatrix {
    return snapshot;
  },
  replace(next: RolePermissionMatrix, persist = false) {
    const sanitized: RolePermissionMatrix = {
      ...next,
      Admin: PERMISSIONS,
    };
    snapshot = sanitized;
    if (persist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
      } catch {
        /* losing the cache is not losing the grants: the API still holds them */
      }
    }
    listeners.forEach((listener) => listener());
  },
};
