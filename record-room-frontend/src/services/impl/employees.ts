/**
 * `drm_employee` registry.
 *
 * Legacy `User.php: employee` supported list/search/add/edit/delete over the
 * employee table, with `emp_department` and `emp_designation` as the picklists.
 */

import { err, ok, type EmployeeQuery, type EmployeesApi } from '../contracts';
import { newId, store, timestamp } from '../store';
import type { Department, Employee } from '../../types';
import { log } from './audit';

function matchSearch(employee: Employee, needle: string): boolean {
  return [
    employee.employeeCode,
    employee.name,
    employee.fatherName,
    employee.email,
    employee.mobile,
    employee.department,
    employee.designation,
  ]
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

let departmentCatalog: Department[] = [];

function currentDepartments(): Department[] {
  const names = new Set(store.getState().employees.map((employee) => employee.department.trim()).filter(Boolean));
  const existing = new Map(departmentCatalog.map((department) => [department.name, department]));
  for (const name of names) {
    if (!existing.has(name)) {
      const id = newId('dept');
      existing.set(name, {
        id,
        code: `D-${id.slice(-6).toUpperCase()}`,
        name,
        active: true,
        modifiedAt: timestamp(),
      });
    }
  }
  departmentCatalog = [...existing.values()].sort((a, b) => a.name.localeCompare(b.name, 'en-IN'));
  return departmentCatalog;
}

export const employeesService: EmployeesApi = {
  async list(query: EmployeeQuery = {}) {
    const search = query.search?.trim().toLowerCase() ?? '';
    const filtered = store.getState().employees.filter((employee) => {
      if (search && !matchSearch(employee, search)) return false;
      if (
        query.department &&
        query.department !== 'All' &&
        employee.department !== query.department
      ) {
        return false;
      }
      if (query.status && query.status !== 'All' && employee.status !== query.status) return false;
      return true;
    });
    filtered.sort((a, b) => a.name.localeCompare(b.name, 'en-IN'));
    const pageSize = Math.max(1, query.pageSize ?? 10);
    const page = Math.max(1, query.page ?? 1);
    return {
      items: filtered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize),
      total: filtered.length,
      page,
      pageSize,
    };
  },

  async get(id) {
    return store.getState().employees.find((employee) => employee.id === id) ?? null;
  },

  async byCode(code) {
    const needle = code.trim().toUpperCase();
    if (!needle) return null;
    return (
      store
        .getState()
        .employees.find((employee) => employee.employeeCode.toUpperCase() === needle) ?? null
    );
  },

  async create(input) {
    const code = input.employeeCode.trim().toUpperCase();
    if (!code) return err('Employee code is required.', 'employeeCode');
    if (await employeesService.byCode(code))
      return err(`${code} is already registered.`, 'employeeCode');
    if (!input.name.trim()) return err('Employee name is required.', 'name');
    if (input.mobile && !/^\d{10}$/.test(input.mobile.trim())) {
      return err('Mobile must be 10 digits.', 'mobile');
    }

    const now = timestamp();
    const employee: Employee = {
      ...input,
      id: newId('emp'),
      employeeCode: code,
      name: input.name.trim(),
      createdAt: now,
      modifiedAt: now,
      status: 'Active',
    };

    store.update((draft) => {
      draft.employees.push(employee);
      log(draft, {
        action: 'Create',
        entity: 'Employee',
        entityId: employee.id,
        before: '—',
        after: `${code} · ${employee.name}`,
        summary: `Employee ${code} registered`,
      });
    });
    return ok(employee);
  },

  async update(id, input) {
    const current = await employeesService.get(id);
    if (!current) return err('Employee not found.', 'id');

    if (input.employeeCode && input.employeeCode.trim().toUpperCase() !== current.employeeCode) {
      const clash = await employeesService.byCode(input.employeeCode);
      if (clash)
        return err(
          `${input.employeeCode.trim().toUpperCase()} is already registered.`,
          'employeeCode',
        );
    }
    if (input.mobile && !/^\d{10}$/.test(input.mobile.trim())) {
      return err('Mobile must be 10 digits.', 'mobile');
    }

    const updated: Employee = {
      ...current,
      ...input,
      employeeCode: input.employeeCode?.trim().toUpperCase() ?? current.employeeCode,
      modifiedAt: timestamp(),
    };

    store.update((draft) => {
      const index = draft.employees.findIndex((employee) => employee.id === id);
      if (index < 0) return;
      draft.employees[index] = updated;
      log(draft, {
        action: 'Update',
        entity: 'Employee',
        entityId: id,
        before: `${current.employeeCode} · ${current.status}`,
        after: `${updated.employeeCode} · ${updated.status}`,
        summary: `Employee ${updated.employeeCode} updated`,
      });
    });
    return ok(updated);
  },

  async remove(id) {
    const current = await employeesService.get(id);
    if (!current) return err('Employee not found.', 'id');
    store.update((draft) => {
      draft.employees = draft.employees.filter((employee) => employee.id !== id);
      log(draft, {
        action: 'Delete',
        entity: 'Employee',
        entityId: id,
        before: `${current.employeeCode} · ${current.name}`,
        after: 'deleted',
        summary: `Employee ${current.employeeCode} removed`,
      });
    });
    return ok(true);
  },

  async departments() {
    return currentDepartments().filter((department) => department.active).map((department) => department.name);
  },

  async listDepartments(includeInactive = true) {
    return currentDepartments().filter((department) => includeInactive || department.active);
  },

  async createDepartment(input) {
    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();
    if (!code || !name) return err('Department code and name are required.', 'name');
    if (currentDepartments().some((department) => department.code === code || department.name.toLowerCase() === name.toLowerCase())) {
      return err('A department with this code or name already exists.', 'code');
    }
    const department: Department = { ...input, id: newId('dept'), code, name, modifiedAt: timestamp() };
    departmentCatalog = [...departmentCatalog, department];
    return ok(department);
  },

  async updateDepartment(id, input) {
    const current = currentDepartments().find((department) => department.id === id);
    if (!current) return err('Department not found.', 'id');
    const code = input.code?.trim().toUpperCase() ?? current.code;
    const name = input.name?.trim() ?? current.name;
    if (!code || !name) return err('Department code and name are required.', 'name');
    if (currentDepartments().some((department) => department.id !== id && (department.code === code || department.name.toLowerCase() === name.toLowerCase()))) {
      return err('A department with this code or name already exists.', 'code');
    }
    const updated = { ...current, ...input, code, name, modifiedAt: timestamp() };
    departmentCatalog = departmentCatalog.map((department) => department.id === id ? updated : department);
    store.update((draft) => {
      for (const employee of draft.employees) {
        if (employee.department === current.name) {
          employee.department = name;
          employee.modifiedAt = updated.modifiedAt;
        }
      }
    });
    return ok(updated);
  },
};
