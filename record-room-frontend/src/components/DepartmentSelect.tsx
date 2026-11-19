import { useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { useQuery, useService } from '../hooks/useService';
import { Field, SelectInput, TextInput } from './ui/Field';
import type { Department } from '../types';

const OTHER = '__other__';

/**
 * A department field backed by the managed list (round 3): pick from the
 * departments the admin maintains, or type a name when it is not in the list
 * yet. In local mode — and on any API where the list has not been filled — the
 * field falls back to free text with the departments already in the employee
 * master as suggestions.
 */
export function DepartmentSelect({
  id,
  value,
  onChange,
  label = 'Department',
  required = false,
  hint,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
  hint?: string;
}) {
  const service = useService();
  const [typing, setTyping] = useState(false);

  // The managed list first; the employee master's distinct departments stand in
  // when the API has none yet, so the picker is never empty for no reason.
  const { data: managed } = useQuery(() => service.departments.list(), [], [] as Department[]);
  const { data: fromEmployees } = useQuery(
    () => service.employees.departments(),
    [],
    [] as string[],
  );

  const options = (
    managed.length > 0 ? managed.map((department) => department.name) : fromEmployees
  ).filter((name) => name.length > 0);
  const inList = options.some((name) => name === value);

  if (options.length === 0 || typing || (value.length > 0 && !inList)) {
    return (
      <Field label={label} htmlFor={id} required={required} hint={hint}>
        <div className="flex gap-2">
          <TextInput
            id={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Department name"
          />
          {options.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setTyping(false);
                if (!inList) onChange('');
              }}
              className="focus-ring muted grid size-11 shrink-0 place-items-center rounded-lg border border-base hover:bg-[var(--rr-surface-2)]"
              aria-label="Pick from the department list"
              title="Pick from the department list"
            >
              <CaretDown size={16} />
            </button>
          )}
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} htmlFor={id} required={required} hint={hint}>
      <SelectInput
        id={id}
        value={value}
        onChange={(event) => {
          if (event.target.value === OTHER) {
            setTyping(true);
            onChange('');
            return;
          }
          onChange(event.target.value);
        }}
      >
        <option value="">Select a department</option>
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
            {managed.length > 0
              ? ` · ${managed.find((department) => department.name === name)?.code ?? ''}`
              : ''}
          </option>
        ))}
        <option value={OTHER}>Other — type a name…</option>
      </SelectInput>
    </Field>
  );
}
