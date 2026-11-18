/**
 * Runtime store behind `can()` (design doc V2-EDITABLE-PERMISSIONS §5).
 *
 * `can()` is called synchronously in 16 files, so the editable matrix lives
 * behind a synchronous external store: seeded from the v1 lists (first paint
 * identical to the static build), replaceable after an admin edit or when the
 * API's matrix arrives. Local-mode edits persist in localStorage.
 */

import type { Role } from '../types';
import { MATRIX_V1, type Permission, type RolePermissionMatrix } from './permissions-matrix';

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
    snapshot = next;
    if (persist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* losing the cache is not losing the grants: the API still holds them */
      }
    }
    listeners.forEach((listener) => listener());
  },
};
