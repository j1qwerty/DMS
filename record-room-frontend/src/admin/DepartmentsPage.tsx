import { useState } from 'react';
import { Buildings, PencilSimple, Plus, Trash, WarningCircle } from '@phosphor-icons/react';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Field, TextArea, TextInput } from '../components/ui/Field';
import { EmptyState } from '../components/ui/EmptyState';
import { Badge } from '../components/ui/Badge';
import { RowSkeleton } from '../components/ui/Skeletons';
import { useFlash, useQuery, useService, useSession } from '../hooks/useService';
import type { Department } from '../types';

/**
 * The managed department list (round 3): names and codes in one place, so the
 * employee, custody and file forms pick from it instead of everyone typing
 * their own spelling. Renaming a department follows the employees; deleting
 * one that employees still use is refused.
 */
export function DepartmentsPage() {
  const service = useService();
  const { allowed } = useSession();
  const { success, danger } = useFlash();
  const canEdit = allowed('employees.edit');

  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);

  const {
    data: departments,
    loading,
    reload,
  } = useQuery(() => service.departments.list(), [], [] as Department[]);

  const apply = async (
    write: Promise<{ ok: boolean; error?: string }>,
    message: string,
  ): Promise<boolean> => {
    const result = await write;
    if (!result.ok) {
      danger(result.error ?? 'That change was refused.');
      return false;
    }
    success(message);
    reload();
    return true;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Departments"
        description="The departments every form picks from."
        actions={
          canEdit && (
            <Button icon={<Plus size={17} />} onClick={() => setEditing('new')}>
              Add department…
            </Button>
          )
        }
      />

      <Card padding={false} className="overflow-hidden">
        {loading && departments.length === 0 ? (
          <div className="p-4 sm:p-6">
            <RowSkeleton rows={5} />
          </div>
        ) : departments.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No departments yet"
              description={
                canEdit
                  ? 'Add the departments the registry, employees and custody forms should offer.'
                  : 'An administrator maintains the department list here.'
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-[var(--rr-bg)] text-xs uppercase tracking-wider muted">
                <tr>
                  <th className="px-5 py-3">Department</th>
                  <th className="px-5 py-3">Code</th>
                  <th className="px-5 py-3">Employees</th>
                  <th className="px-5 py-3">Remarks</th>
                  {canEdit && (
                    <th className="px-5 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--rr-border)]">
                {departments.map((department) => (
                  <tr key={department.id} className="hover:bg-[var(--rr-bg)]">
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-2 font-semibold">
                        <Buildings size={15} className="muted shrink-0" />
                        {department.name}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[13px]">{department.code}</td>
                    <td className="px-5 py-3.5">
                      {department.employeeCount > 0 ? (
                        <Badge tone="info">{department.employeeCount} filed</Badge>
                      ) : (
                        <span className="muted text-xs">none</span>
                      )}
                    </td>
                    <td className="muted max-w-[280px] truncate px-5 py-3.5 text-[13px]">
                      {department.remarks || '—'}
                    </td>
                    {canEdit && (
                      <td className="px-5 py-3.5">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<PencilSimple size={15} />}
                            onClick={() => setEditing(department)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Trash size={15} />}
                            onClick={() => setDeleting(department)}
                          >
                            Remove
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add department' : `Edit ${editing?.name ?? ''}`}
        description="The code is what external systems exchange; the name is what people read on every form."
      >
        {editing && (
          <DepartmentForm
            initial={editing === 'new' ? null : editing}
            onDone={async (input) => {
              const saved =
                editing === 'new'
                  ? await apply(service.departments.create(input), `${input.name} added.`)
                  : await apply(
                      service.departments.update((editing as Department).id, input),
                      `${input.name} updated.`,
                    );
              if (saved) setEditing(null);
            }}
          />
        )}
      </Modal>

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Remove ${deleting?.name ?? ''}`}
        description="A department employees are still filed under cannot be deleted — rename it instead."
      >
        {deleting && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <WarningCircle size={20} className="shrink-0 text-[var(--rr-danger)]" />
              <p className="text-sm leading-6">
                Remove <span className="font-semibold">{deleting.name}</span> (
                <span className="font-mono">{deleting.code}</span>) from the department list?
                {deleting.employeeCount > 0
                  ? ` ${deleting.employeeCount} employee(s) are still filed under it, so the API will refuse this.`
                  : ' No employees are filed under it.'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="danger"
                className="flex-1"
                onClick={async () => {
                  const removed = await apply(
                    service.departments.remove(deleting.id),
                    `${deleting.name} removed.`,
                  );
                  if (removed) setDeleting(null);
                }}
              >
                Remove department
              </Button>
              <Button variant="ghost" className="flex-1" onClick={() => setDeleting(null)}>
                Keep it
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function DepartmentForm({
  initial,
  onDone,
}: {
  initial: Department | null;
  onDone: (input: { name: string; code: string; remarks: string }) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [remarks, setRemarks] = useState(initial?.remarks ?? '');
  const [busy, setBusy] = useState(false);

  const valid = name.trim().length > 0 && code.trim().length > 0;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy) return;
        setBusy(true);
        void onDone({ name: name.trim(), code: code.trim(), remarks: remarks.trim() }).finally(() =>
          setBusy(false),
        );
      }}
    >
      <Field label="Department name" htmlFor="department-name" required>
        <TextInput
          id="department-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Establishment"
        />
      </Field>
      <Field
        label="Code"
        htmlFor="department-code"
        required
        hint="Short and stable — reports and external systems key on it."
      >
        <TextInput
          id="department-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="EST"
          className="font-mono uppercase"
        />
      </Field>
      <Field label="Remarks" htmlFor="department-remarks">
        <TextArea
          id="department-remarks"
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          placeholder="Optional"
          className="min-h-20"
        />
      </Field>
      <Button type="submit" disabled={!valid || busy} className="w-full">
        {busy ? 'Saving…' : initial ? 'Save department' : 'Add department'}
      </Button>
    </form>
  );
}
