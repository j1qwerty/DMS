import { useState } from 'react';
import { Buildings, PencilSimple, Plus } from '@phosphor-icons/react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Field, SelectInput, TextInput } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { TableSkeleton } from '../components/ui/Skeletons';
import { useFlash, useQuery, useService, useSession } from '../hooks/useService';
import type { Department } from '../types';

type DepartmentFormValue = { code: string; name: string; active: boolean };

export function DepartmentsPage() {
  const service = useService();
  const { allowed } = useSession();
  const { success, danger } = useFlash();
  const [editing, setEditing] = useState<Department | null>(null);
  const [creating, setCreating] = useState(false);
  const { data: departments, loading, reload } = useQuery(
    () => service.employees.listDepartments(true),
    [],
    [] as Department[],
  );

  const save = async (value: DepartmentFormValue) => {
    const result = editing
      ? await service.employees.updateDepartment(editing.id, value)
      : await service.employees.createDepartment(value);
    if (!result.ok) {
      danger(result.error);
      return;
    }
    success(editing ? 'Department updated.' : 'Department added.');
    setEditing(null);
    setCreating(false);
    reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Administration"
        title="Departments"
        description="Maintain the department codes and names used by employee records, issue receipts and custody handovers."
        actions={
          allowed('departments.manage') ? (
            <Button icon={<Plus size={17} />} onClick={() => setCreating(true)}>Add department</Button>
          ) : undefined
        }
      />
      <Card padding={false} className="overflow-hidden">
        {loading && departments.length === 0 ? (
          <div className="p-6"><TableSkeleton rows={5} columns={[1, 2, 1, 1]} /></div>
        ) : departments.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No departments configured" description="Add the approved department codes and names before assigning employees or recording custody." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-[var(--rr-bg)] text-xs uppercase tracking-wider muted">
                <tr>
                  <th className="px-5 py-3">Code</th>
                  <th className="px-5 py-3">Department name</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--rr-border)]">
                {departments.map((department) => (
                  <tr key={department.id} className="hover:bg-[var(--rr-bg)]">
                    <td className="px-5 py-4 font-mono text-xs">{department.code}</td>
                    <td className="px-5 py-4 font-semibold">{department.name}</td>
                    <td className="px-5 py-4">
                      <Badge tone={department.active ? 'success' : 'neutral'}>{department.active ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="px-5 py-4 text-right">
                      {allowed('departments.manage') && (
                        <Button variant="ghost" size="sm" icon={<PencilSimple size={15} />} onClick={() => setEditing(department)}>Edit</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Add department">
        <DepartmentForm onSubmit={save} />
      </Modal>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit department">
        {editing && <DepartmentForm initial={editing} onSubmit={save} />}
      </Modal>
    </div>
  );
}

function DepartmentForm({
  initial,
  onSubmit,
}: {
  initial?: Department;
  onSubmit: (value: DepartmentFormValue) => Promise<void>;
}) {
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [active, setActive] = useState(initial?.active ?? true);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !code.trim() || !name.trim()) return;
        setBusy(true);
        void onSubmit({ code, name, active }).finally(() => setBusy(false));
      }}
    >
      <div className="flex items-center gap-2 rounded-lg bg-accent-soft p-3 text-sm text-accent">
        <Buildings size={18} /> Department directory entry
      </div>
      <Field label="Department code" htmlFor="department-code" required>
        <TextInput id="department-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="EST" className="font-mono" />
      </Field>
      <Field label="Department name" htmlFor="department-name" required>
        <TextInput id="department-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Establishment" />
      </Field>
      <Field label="Status" htmlFor="department-status">
        <SelectInput id="department-status" value={active ? 'Active' : 'Inactive'} onChange={(event) => setActive(event.target.value === 'Active')}>
          <option>Active</option>
          <option>Inactive</option>
        </SelectInput>
      </Field>
      <Button type="submit" disabled={busy || !code.trim() || !name.trim()} className="w-full">
        {busy ? 'Saving…' : 'Save department'}
      </Button>
    </form>
  );
}
