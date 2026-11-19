import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { MagnifyingGlass, User, XCircle } from '@phosphor-icons/react';
import { useQuery, useService } from '../hooks/useService';
import type { Employee } from '../types';

/**
 * One field instead of two (round 3): type a name, code or department and the
 * matches appear as you type; pick one with a click or the arrow keys. A query
 * that matches nobody stays in the field — the caller records the typed name
 * and the UI says clearly the borrower is not in the employee database.
 */
export function EmployeeCombobox({
  selected,
  text,
  onTextChange,
  onSelect,
  onClear,
  label = 'Find employee',
  hint,
}: {
  /** The employee picked from the list, when one is picked. */
  selected: Employee | null;
  /** What is in the field: the typed query, or the picked employee's label. */
  text: string;
  onTextChange: (text: string) => void;
  onSelect: (employee: Employee) => void;
  onClear: () => void;
  label?: string;
  hint?: string;
}) {
  const service = useService();
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [debounced, setDebounced] = useState('');

  // Debounce the query so a fast typist does not fire a request per key.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(text.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [text]);

  const { data: matches, loading } = useQuery(
    () =>
      open && debounced.length >= 2
        ? service.employees.list({ search: debounced, pageSize: 8, status: 'Active' })
        : Promise.resolve(null),
    [debounced, open],
    null,
  );

  const rows = useMemo(() => matches?.items ?? [], [matches]);

  // Close on outside click; Escape clears the pick.
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const choose = (employee: Employee) => {
    onSelect(employee);
    setOpen(false);
  };

  const notListed =
    text.trim().length > 0 && !selected && rows.length === 0 && !loading && debounced.length >= 2;

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={listId} className="mb-1.5 block text-[13px] font-semibold">
        {label}
      </label>
      <div className="relative">
        <MagnifyingGlass
          size={16}
          className="muted pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
        />
        <input
          id={listId}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          autoComplete="off"
          value={text}
          onChange={(event) => {
            onTextChange(event.target.value);
            if (selected) onClear();
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && rows.length > 0) {
              event.preventDefault();
              setHighlight((index) => (index + 1) % rows.length);
            } else if (event.key === 'ArrowUp' && rows.length > 0) {
              event.preventDefault();
              setHighlight((index) => (index - 1 + rows.length) % rows.length);
            } else if (event.key === 'Enter' && open && rows[highlight]) {
              event.preventDefault();
              choose(rows[highlight]);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder="Type an employee name, code or department…"
          className="focus-ring h-11 w-full rounded-lg border border-base bg-[var(--rr-bg)] pl-10 pr-10 text-sm outline-none"
        />
        {(text.length > 0 || selected) && (
          <button
            type="button"
            onClick={() => {
              onTextChange('');
              onClear();
            }}
            aria-label="Clear the employee field"
            className="muted absolute right-2.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md hover:bg-[var(--rr-surface-2)]"
          >
            <XCircle size={16} />
          </button>
        )}
      </div>

      {selected && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--rr-success)]">
          <User size={13} weight="bold" />
          {selected.name} · {selected.employeeCode} · {selected.department}
        </p>
      )}

      {notListed && (
        <p
          role="status"
          className="mt-1.5 rounded-lg border border-[color-mix(in_srgb,var(--rr-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--rr-warning)_10%,transparent)] px-3 py-2 text-xs leading-5 text-[var(--rr-warning)]"
        >
          No employee matches “{text.trim()}”. The issue will record this name exactly as typed —
          the borrower is not in the employee database.
        </p>
      )}

      {open && (
        <div
          id={`${listId}-list`}
          role="listbox"
          aria-label="Employee matches"
          className="absolute z-30 mt-1.5 max-h-64 w-full overflow-y-auto rounded-lg border border-base bg-[var(--rr-surface)] shadow-[var(--rr-shadow)]"
        >
          {loading && debounced.length >= 2 ? (
            <p className="muted px-3 py-2.5 text-sm">Searching…</p>
          ) : rows.length === 0 ? (
            debounced.length < 2 ? (
              <p className="muted px-3 py-2.5 text-sm">Keep typing — at least two characters.</p>
            ) : (
              <p className="muted px-3 py-2.5 text-sm">No match in the employee database.</p>
            )
          ) : (
            rows.map((employee, index) => (
              <button
                key={employee.id}
                type="button"
                role="option"
                aria-selected={index === highlight}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(employee)}
                className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm ${
                  index === highlight ? 'bg-[var(--rr-surface-2)]' : ''
                }`}
              >
                <User size={15} className="muted shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{employee.name}</span>
                  <span className="muted block truncate text-xs">
                    {employee.employeeCode} · {employee.department}
                    {employee.designation ? ` · ${employee.designation}` : ''}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {hint && !notListed && <p className="muted mt-1.5 text-xs">{hint}</p>}
    </div>
  );
}
