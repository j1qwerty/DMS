import type { Role } from '../types';

/** The compile-time permission catalogue — same 21 keys as the API's PermissionService.Catalogue. */
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

export type RolePermissionMatrix = Record<Role, readonly Permission[]>;

/** The v1 lists, verbatim — the seed of the runtime store and the migration baseline. */
export const MATRIX_V1: RolePermissionMatrix = {
  Admin: PERMISSIONS,
  Supervisor: [
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
    'audit.view',
    'reports.view',
    'reports.export',
    'barcodes.print',
  ],
  Operator: [
    'files.view',
    'files.create',
    'issue.issue',
    'issue.return',
    'locations.view',
    'digitization.view',
    'digitization.upload',
    'studio.use',
    'employees.view',
    'reports.view',
    'barcodes.print',
  ],
  Employee: ['files.view', 'digitization.view', 'studio.use', 'reports.view'],
};
