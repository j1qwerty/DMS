/**
 * Role → permission matrix.
 *
 * The matrix is editable at runtime (V2-EDITABLE-PERMISSIONS): reads go
 * through `permissionsStore`, seeded from the v1 lists so first paint is
 * byte-identical to the static build. The API enforces the same grants
 * server-side through `perm:*` policies — hiding a control here is not the
 * authorization boundary.
 */

import type { Role } from '../types';
import { MATRIX_V1, permissionsStore } from './permissionsStore';

export const PERMISSIONS = [
  'files.view',
  'files.create',
  'files.edit',
  'files.bulkImport',
  'issue.issue',
  'issue.return',
  'locations.view',
  'locations.edit',
  'digitization.view',
  'digitization.upload',
  'digitization.review',
  'studio.use',
  'employees.view',
  'employees.edit',
  'users.view',
  'users.edit',
  'audit.view',
  'audit.fileViews',
  'reports.view',
  'reports.export',
  'barcodes.print',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export { MATRIX_V1 };

export function can(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false;
  if (role === 'Admin') return true;
  return permissionsStore.get()[role].includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  if (role === 'Admin') return PERMISSIONS;
  return permissionsStore.get()[role];
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  Admin: 'Full access including users, locations and configuration.',
  Supervisor: 'Approves digitization, manages locations and employee records.',
  Operator: 'Runs the desks: file creation, issue, return and scanning.',
  Employee: 'Reads own registry and digitization records.',
};
