/**
 * The runtime permission store (V2-EDITABLE-PERMISSIONS §5): `can()` stays
 * synchronous, the matrix is replaceable, and local edits persist.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { can, permissionsFor, PERMISSIONS, MATRIX_V1 } from '../src/services/permissions';
import { permissionsStore } from '../src/services/permissionsStore';
import type { Role, RolePermissionMatrix } from '../src/services/permissionsStore';

describe('permission store', () => {
  beforeEach(() => {
    permissionsStore.replace(MATRIX_V1);
  });

  it('seeds every role from the v1 lists', () => {
    expect(permissionsStore.get()).toEqual(MATRIX_V1);
    expect(can('Admin', 'users.edit')).toBe(true);
    expect(can('Supervisor', 'users.edit')).toBe(false);
    expect(can('Employee', 'files.view')).toBe(true);
    expect(can('Employee', 'files.create')).toBe(false);
  });

  it('can() follows a replaced matrix without code changes', () => {
    expect(can('Operator', 'digitization.review')).toBe(false);
    const updated: RolePermissionMatrix = {
      ...MATRIX_V1,
      Operator: [...MATRIX_V1.Operator, 'digitization.review' as never],
    };
    permissionsStore.replace(updated);
    expect(can('Operator', 'digitization.review')).toBe(true);
    expect(permissionsFor('Operator')).toContain('digitization.review');
    permissionsStore.replace(MATRIX_V1);
    expect(can('Operator', 'digitization.review')).toBe(false);
  });

  it('notifies subscribers on replace', () => {
    let notified = 0;
    const unsubscribe = permissionsStore.subscribe(() => (notified += 1));
    permissionsStore.replace({ ...MATRIX_V1, Employee: [...MATRIX_V1.Employee, 'files.create' as never] });
    expect(notified).toBe(1);
    unsubscribe();
    permissionsStore.replace(MATRIX_V1);
    expect(notified).toBe(1);
  });

  it('covers the whole catalogue for the Admin role and stays in the catalogue', () => {
    expect(permissionsFor('Admin')).toEqual(PERMISSIONS);
    for (const role of ['Admin', 'Supervisor', 'Operator', 'Employee'] as Role[]) {
      for (const permission of permissionsFor(role)) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });
});
