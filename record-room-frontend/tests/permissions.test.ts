import { describe, expect, it } from 'vitest';
import { can, permissionsFor, PERMISSIONS } from '../src/services/permissions';
import type { Role } from '../src/types';

describe('four-role capability matrix', () => {
  it('keeps Admin as the recovery and document-administration role', () => {
    expect(permissionsFor('Admin')).toEqual(PERMISSIONS);
    expect(can('Admin', 'users.edit')).toBe(true);
    expect(can('Admin', 'files.documentDelete')).toBe(true);
    expect(can('Admin', 'custody.manage')).toBe(true);
  });

  it('allows Supervisor operational approval and user viewing, but not user administration', () => {
    expect(can('Supervisor', 'custody.manage')).toBe(true);
    expect(can('Supervisor', 'digitization.review')).toBe(true);
    expect(can('Supervisor', 'users.view')).toBe(true);
    expect(can('Supervisor', 'users.edit')).toBe(false);
    expect(can('Supervisor', 'files.documentDelete')).toBe(false);
  });

  it('allows Operator desk work but not supervisory review or custody sign-off', () => {
    expect(can('Operator', 'files.create')).toBe(true);
    expect(can('Operator', 'issue.issue')).toBe(true);
    expect(can('Operator', 'issue.return')).toBe(true);
    expect(can('Operator', 'digitization.upload')).toBe(true);
    expect(can('Operator', 'custody.view')).toBe(true);
    expect(can('Operator', 'custody.manage')).toBe(false);
    expect(can('Operator', 'digitization.review')).toBe(false);
  });

  it('keeps Employee read-only for the granted registry and custody views', () => {
    expect(can('Employee', 'files.view')).toBe(true);
    expect(can('Employee', 'digitization.view')).toBe(true);
    expect(can('Employee', 'custody.view')).toBe(true);
    expect(can('Employee', 'issue.issue')).toBe(false);
    expect(can('Employee', 'employees.view')).toBe(false);
    expect(can('Employee', 'custody.manage')).toBe(false);
  });

  it('denies permissions when no authenticated role is present', () => {
    expect(can(undefined, 'files.view')).toBe(false);
  });

  it('has no duplicate permission identifiers', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    const roles: Role[] = ['Admin', 'Supervisor', 'Operator', 'Employee'];
    for (const role of roles) {
      expect(new Set(permissionsFor(role)).size).toBe(permissionsFor(role).length);
    }
  });
});
