/**
 * The managed department list (round 3), local mode. Mirrors the API's
 * `DepartmentsService`: unique names and codes, rename follows the employees,
 * deletion refused while an employee is still filed under the department.
 */

import { err, ok, type DepartmentsApi } from '../contracts';
import type { Department } from '../../types';
import { newId, store, timestamp } from '../store';
import { log } from './audit';
import { session } from './session';

export const departmentsService: DepartmentsApi = {
  async list() {
    const { departments, employees } = store.getState();
    return departments
      .map((department) => ({
        ...department,
        employeeCount: employees.filter((employee) => employee.department === department.name)
          .length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en-IN'));
  },

  async create(input) {
    const name = input.name.trim();
    const code = input.code.trim().toUpperCase();
    if (!name) return err('Department name is required.', 'name');
    if (!code) return err('Department code is required.', 'code');

    const { departments } = store.getState();
    if (departments.some((department) => department.name === name)) {
      return err(`A department named ${name} already exists.`, 'name');
    }
    if (departments.some((department) => department.code === code)) {
      return err(`The code ${code} is already in use.`, 'code');
    }

    const department: Department = {
      id: newId('department'),
      name,
      code,
      remarks: input.remarks?.trim() ?? '',
      employeeCount: 0,
      createdAt: timestamp(),
    };
    store.update((draft) => {
      draft.departments.push(department);
      log(draft, {
        action: 'Create',
        entity: 'Department',
        entityId: department.id,
        before: '—',
        after: `${name} (${code})`,
        summary: `${session.actorName()} added department ${name} (${code})`,
      });
    });
    return ok(department);
  },

  async update(id, input) {
    const row = store.getState().departments.find((department) => department.id === id);
    if (!row) return err('Department not found.');

    const name = input.name.trim();
    const code = input.code.trim().toUpperCase();
    if (!name) return err('Department name is required.', 'name');
    if (!code) return err('Department code is required.', 'code');

    const { departments } = store.getState();
    if (departments.some((department) => department.id !== id && department.name === name)) {
      return err(`A department named ${name} already exists.`, 'name');
    }
    if (departments.some((department) => department.id !== id && department.code === code)) {
      return err(`The code ${code} is already in use.`, 'code');
    }

    const before = `${row.name} (${row.code})`;
    const oldName = row.name;
    store.update((draft) => {
      const department = draft.departments.find((item) => item.id === id);
      if (!department) return;
      department.name = name;
      department.code = code;
      department.remarks = input.remarks?.trim() ?? '';
      // A rename follows the employees, so their history stays under one spelling.
      if (name !== oldName) {
        for (const employee of draft.employees) {
          if (employee.department === oldName) employee.department = name;
        }
      }
      log(draft, {
        action: 'Update',
        entity: 'Department',
        entityId: id,
        before,
        after: `${name} (${code})`,
        summary: `${session.actorName()} updated department ${before} → ${name} (${code})`,
      });
    });
    const updated = store.getState().departments.find((department) => department.id === id);
    return updated ? ok(updated) : err('Department not found.');
  },

  async remove(id) {
    const row = store.getState().departments.find((department) => department.id === id);
    if (!row) return err('Department not found.');

    const inUse = store
      .getState()
      .employees.filter((employee) => employee.department === row.name).length;
    if (inUse > 0) {
      return err(
        `${inUse} employee(s) are still filed under ${row.name}; rename the department instead of deleting it.`,
        'employees',
      );
    }

    store.update((draft) => {
      draft.departments = draft.departments.filter((department) => department.id !== id);
      log(draft, {
        action: 'Delete',
        entity: 'Department',
        entityId: id,
        before: `${row.name} (${row.code})`,
        after: '—',
        summary: `${session.actorName()} removed department ${row.name}`,
      });
    });
    return ok(true);
  },
};
