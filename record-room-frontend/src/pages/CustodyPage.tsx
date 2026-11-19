import { useState } from 'react';
import {
  DownloadSimple,
  Eye,
  MagnifyingGlass,
  Plus,
  Scales,
  SealCheck,
  ArrowUDownLeft,
} from '@phosphor-icons/react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { Field, SelectInput, TextArea, TextInput } from '../components/ui/Field';
import { EmptyState } from '../components/ui/EmptyState';
import { TableSkeleton } from '../components/ui/Skeletons';
import { SectionHeader } from '../components/ui/SectionHeader';
import { DepartmentSelect } from '../components/DepartmentSelect';
import { useFlash, useQuery, useService, useSession } from '../hooks/useService';
import { downloadCsv, toCsv } from '../lib/csv';
import { suggestedBatchRef } from '../lib/batchRef';
import type { CustodyDirection, CustodyEvent } from '../types';
import type { Page } from '../services/contracts';

const EMPTY_PAGE: Page<CustodyEvent> = { items: [], total: 0, page: 1, pageSize: 50 };
const DIRECTIONS = ['All', 'Intake', 'Return'] as const;

/** The counted figure once reconciled, otherwise what the department declared. */
function expectedOf(event: CustodyEvent): number {
  return event.reconciledCount ?? event.fileCount;
}

function DirectionBadge({ direction }: { direction: CustodyDirection }) {
  return (
    <Badge tone={direction === 'Intake' ? 'info' : 'neutral'}>
      {direction === 'Intake' ? 'Intake in' : 'Return out'}
    </Badge>
  );
}

function CountedCell({ event, inline = false }: { event: CustodyEvent; inline?: boolean }) {
  if (event.reconciledCount == null) {
    return (
      <span className={inline ? 'muted text-xs' : 'muted text-[13px]'}>
        {event.direction === 'Intake' ? 'Not counted yet' : '—'}
      </span>
    );
  }
  const variance = event.reconciledCount - event.fileCount;
  const label = `${event.reconciledCount}${variance === 0 ? '' : ` (${variance > 0 ? '+' : ''}${variance})`}`;
  if (inline) return <span className="font-mono text-xs">{label}</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[13px]">{event.reconciledCount}</span>
      {variance !== 0 && (
        <Badge tone={variance > 0 ? 'info' : 'danger'}>
          {variance > 0 ? `+${variance} extra` : `${variance} short`}
        </Badge>
      )}
    </span>
  );
}

/** How much of an intake batch is still out, from its return rows. */
function remainingOf(event: CustodyEvent): number {
  return Math.max(0, expectedOf(event) - (event.returnedCount ?? 0));
}

function ReturnedCell({ event, inline = false }: { event: CustodyEvent; inline?: boolean }) {
  if (event.direction !== 'Intake') return <span className="muted text-[13px]">—</span>;
  const expected = expectedOf(event);
  const back = event.returnedCount ?? 0;
  const done = back >= expected;
  if (inline) {
    return (
      <span className={`text-xs ${done ? 'text-[var(--rr-success)]' : 'muted'}`}>
        {back} of {expected} back
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="font-mono text-[13px]">
        {back}/{expected}
      </span>
      {done ? (
        <Badge tone="success">All back</Badge>
      ) : back > 0 ? (
        <Badge tone="info">{remainingOf(event)} still out</Badge>
      ) : (
        <span className="muted text-xs">none yet</span>
      )}
    </span>
  );
}

function StateCell({ event }: { event: CustodyEvent }) {
  if (event.signedOffAt) {
    return (
      <span className="flex flex-col gap-1">
        <Badge tone="success">Signed off</Badge>
        <span className="muted truncate text-[11px]" title={event.signedOffBy ?? undefined}>
          by {event.signedOffBy}
        </span>
      </span>
    );
  }
  return <Badge tone="warning">Open</Badge>;
}

/**
 * The digitization custody register (work plan §3.8, round 3): both directions
 * on one page — an intake records what a department handed over and what was
 * actually counted (the reconciliation), and the Return… button on an intake
 * row records the batch coming back, all at once or partially (6 of 10, then
 * 4 of 10). Rows are immutable, so the only actions are record, count, return
 * and sign off.
 *
 * Rendered as the Custody register tab of the Digitization page; the section
 * header replaces the page header it had as a standalone route.
 */
export function CustodyRegister() {
  const service = useService();
  const { allowed, user } = useSession();
  const { success, danger } = useFlash();

  const [direction, setDirection] = useState<(typeof DIRECTIONS)[number]>('All');
  const [search, setSearch] = useState('');
  const [recording, setRecording] = useState(false);
  const [counting, setCounting] = useState<CustodyEvent | null>(null);
  const [signing, setSigning] = useState<CustodyEvent | null>(null);
  const [returning, setReturning] = useState<CustodyEvent | null>(null);
  const [inspecting, setInspecting] = useState<CustodyEvent | null>(null);

  const mayWrite = allowed('digitization.review');

  const {
    data: register,
    loading,
    reload,
  } = useQuery(
    () => service.custody.list({ direction, search, pageSize: 50 }),
    [direction, search],
    EMPTY_PAGE,
    // Custody writes land on the digitization channel from every desk.
    ['digitization'],
  );

  const apply = async (write: Promise<{ ok: boolean; error?: string }>, message: string) => {
    const result = await write;
    if (!result.ok) {
      danger(result.error ?? 'That change was refused.');
      return false;
    }
    success(message);
    reload();
    return true;
  };

  const exportCsv = () => {
    const columns = [
      'Recorded at',
      'Direction',
      'Department',
      'Batch',
      'Vendor',
      'Declared files',
      'Counted files',
      'Counted by',
      'Returned files',
      'Recorded by',
      'Signed off by',
      'Signed off at',
      'Remarks',
    ];
    const rows = register.items.map((event) => [
      event.recordedAt,
      event.direction,
      event.department,
      event.batchRef,
      event.vendor,
      event.fileCount,
      event.reconciledCount ?? '',
      event.reconciledBy ?? '',
      event.direction === 'Intake' ? `${event.returnedCount ?? 0}/${expectedOf(event)}` : '',
      event.recordedBy,
      event.signedOffBy ?? '',
      event.signedOffAt ?? '',
      event.remarks,
    ]);
    downloadCsv(
      `custody-register-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(columns, rows),
    );
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Custody register"
        description="Intake and return handovers — what was declared, counted and signed off."
        action={
          mayWrite ? (
            <Button icon={<Plus size={17} />} onClick={() => setRecording(true)}>
              Record handover…
            </Button>
          ) : undefined
        }
      />

      <Card padding={false} className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-base p-4 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <MagnifyingGlass
              size={18}
              className="muted pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Department, batch, vendor, remarks…"
              aria-label="Search the custody register"
              className="focus-ring h-11 w-full rounded-lg border border-base bg-[var(--rr-bg)] pl-10 pr-3 text-sm outline-none"
            />
          </div>
          <SelectInput
            value={direction}
            onChange={(event) => setDirection(event.target.value as (typeof DIRECTIONS)[number])}
            aria-label="Filter by direction"
            className="shrink-0 sm:w-44"
          >
            {DIRECTIONS.map((option) => (
              <option key={option} value={option}>
                {option === 'All' ? 'Both directions' : option}
              </option>
            ))}
          </SelectInput>
          <Button
            variant="ghost"
            className="shrink-0"
            icon={<DownloadSimple size={17} />}
            disabled={register.items.length === 0}
            onClick={exportCsv}
          >
            Export CSV
          </Button>
        </div>

        {loading && register.items.length === 0 ? (
          <div className="p-4 sm:p-6">
            <TableSkeleton rows={6} columns={[1.3, 0.9, 1.6, 0.9, 0.9, 1.2, 1.1]} />
          </div>
        ) : register.items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Nothing in the register yet"
              description={
                mayWrite
                  ? 'Record the first handover: the department, how many files arrived, and later what was actually counted.'
                  : 'Custody rows appear here as supervisors record intakes and returns.'
              }
            />
          </div>
        ) : (
          <>
            {/* md and up: the full register table; below md the same rows as
                cards, so a phone never scrolls sideways. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1040px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-[var(--rr-bg)] text-xs uppercase tracking-wider muted">
                  <tr>
                    <th className="px-4 py-3">Recorded</th>
                    <th className="px-4 py-3">Direction</th>
                    <th className="px-4 py-3">Department</th>
                    <th className="px-4 py-3">Batch / vendor</th>
                    <th className="px-4 py-3">Declared</th>
                    <th className="px-4 py-3">Counted</th>
                    <th className="px-4 py-3">Returned</th>
                    <th className="px-4 py-3">State</th>
                    <th className="px-4 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--rr-border)]">
                  {register.items.map((event) => (
                    <tr key={event.id} className="hover:bg-[var(--rr-bg)]">
                      <td className="px-4 py-3.5">
                        <p className="text-[13px]">{event.recordedAt}</p>
                        <p className="muted mt-0.5 text-xs">by {event.recordedBy}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <DirectionBadge direction={event.direction} />
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-[13px] font-semibold">{event.department}</p>
                        {event.remarks && (
                          <p className="muted mt-0.5 max-w-[240px] truncate text-xs">
                            {event.remarks}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-[13px]">
                        {event.batchRef || <span className="muted">—</span>}
                        {event.vendor && <p className="muted mt-0.5 text-xs">{event.vendor}</p>}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[13px]">{event.fileCount}</td>
                      <td className="px-4 py-3.5">
                        <CountedCell event={event} />
                      </td>
                      <td className="px-4 py-3.5">
                        <ReturnedCell event={event} />
                      </td>
                      <td className="px-4 py-3.5">
                        <StateCell event={event} />
                      </td>
                      <td className="px-4 py-3">
                        <RowActions
                          event={event}
                          mayWrite={mayWrite}
                          onCount={setCounting}
                          onSign={setSigning}
                          onReturn={setReturning}
                          onInspect={setInspecting}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-[var(--rr-border)] md:hidden">
              {register.items.map((event) => (
                <li key={event.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <DirectionBadge direction={event.direction} />
                    <StateCell event={event} />
                  </div>
                  <p className="mt-1.5 text-sm font-semibold">{event.department}</p>
                  <p className="muted mt-0.5 text-xs">
                    {event.recordedAt} · by {event.recordedBy}
                  </p>
                  {(event.batchRef || event.vendor) && (
                    <p className="muted mt-0.5 text-xs">
                      {[event.batchRef, event.vendor].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <p className="muted mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span>Declared {event.fileCount}</span>
                    <CountedCell event={event} inline />
                    {event.direction === 'Intake' && <ReturnedCell event={event} inline />}
                  </p>
                  {event.remarks && <p className="muted mt-1 text-xs leading-5">{event.remarks}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <RowActions
                      event={event}
                      mayWrite={mayWrite}
                      onCount={setCounting}
                      onSign={setSigning}
                      onReturn={setReturning}
                      onInspect={setInspecting}
                      compact
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Modal
        open={recording}
        onClose={() => setRecording(false)}
        title="Record a custody handover"
        description="An intake starts the chain; a return closes it. The record cannot be edited afterwards."
      >
        <RecordForm
          onDone={async (input) => {
            const saved = await apply(
              service.custody.record(input),
              `${input.direction} of ${input.fileCount} file(s) for ${input.department} recorded.`,
            );
            if (saved) setRecording(false);
          }}
        />
      </Modal>

      <Modal
        open={counting !== null}
        onClose={() => setCounting(null)}
        title={`Count the ${counting?.department ?? ''} intake`}
        description="The reconciliation step: what was actually received against what was declared."
      >
        {counting && (
          <CountForm
            declared={counting.fileCount}
            onDone={async (count, note) => {
              const saved = await apply(
                service.custody.reconcile(counting.id, count, note),
                `Intake reconciled: ${count} of ${counting.fileCount} counted.`,
              );
              if (saved) setCounting(null);
            }}
          />
        )}
      </Modal>

      <Modal
        open={returning !== null}
        onClose={() => setReturning(null)}
        title={`Return files — ${returning?.department ?? ''} batch`}
        description="Records a return against this intake: all remaining files at once, or part of the batch."
      >
        {returning && (
          <ReturnForm
            event={returning}
            onDone={async (count, remarks) => {
              const saved = await apply(
                service.custody.returnAgainst(returning.id, { fileCount: count, remarks }),
                `Return of ${count} file(s) recorded for ${returning.department}.`,
              );
              if (saved) setReturning(null);
            }}
          />
        )}
      </Modal>

      <Modal
        open={signing !== null}
        onClose={() => setSigning(null)}
        title={`Sign off — ${signing?.department ?? ''}`}
        description="Signing off closes this row: it can no longer be counted or changed."
      >
        {signing && (
          <SignOffForm
            defaultSigner={user?.displayName ?? ''}
            onDone={async (signer) => {
              const saved = await apply(
                service.custody.signOff(signing.id, signer),
                `${signing.direction} for ${signing.department} signed off.`,
              );
              if (saved) setSigning(null);
            }}
          />
        )}
      </Modal>

      <Modal
        open={inspecting !== null}
        onClose={() => setInspecting(null)}
        title={`Custody event — ${inspecting?.department ?? ''}`}
        description="The full record: who created it, who counted it, who signed it off, and the returns against the batch."
      >
        {inspecting && <CustodyDetails event={inspecting} onClose={() => setInspecting(null)} />}
      </Modal>
    </div>
  );
}

type RecordInput = Parameters<ReturnType<typeof useService>['custody']['record']>[0];

function RecordForm({ onDone }: { onDone: (input: RecordInput) => Promise<void> }) {
  const [direction, setDirection] = useState<CustodyDirection>('Intake');
  const [department, setDepartment] = useState('');
  // The batch reference starts as a date-time prefix the user edits from, not
  // a value they must invent (round 3).
  const [batchRef, setBatchRef] = useState(suggestedBatchRef());
  const [vendor, setVendor] = useState('');
  const [fileCount, setFileCount] = useState('1');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  const count = Number(fileCount);
  const valid = department.trim().length > 0 && Number.isFinite(count) && count >= 1;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy) return;
        setBusy(true);
        void onDone({
          direction,
          department: department.trim(),
          fileCount: count,
          batchRef: batchRef.trim(),
          vendor: vendor.trim(),
          remarks: remarks.trim(),
        }).finally(() => setBusy(false));
      }}
    >
      <Field label="Direction" htmlFor="custody-direction">
        <SelectInput
          id="custody-direction"
          value={direction}
          onChange={(event) => setDirection(event.target.value as CustodyDirection)}
        >
          <option value="Intake">Intake — files received from a department</option>
          <option value="Return">Return — files handed back with sign-off</option>
        </SelectInput>
      </Field>
      <DepartmentSelect
        id="custody-department"
        value={department}
        onChange={setDepartment}
        required
      />
      <Field
        label="Files in this handover"
        htmlFor="custody-count"
        required
        hint="The declared total; the actual counted figure is set in the next step for intakes."
      >
        <TextInput
          id="custody-count"
          type="number"
          min={1}
          value={fileCount}
          onChange={(event) => setFileCount(event.target.value)}
        />
      </Field>
      <Field
        label="Digitization batch"
        htmlFor="custody-batch"
        hint="Pre-filled with today's date and time — edit it if the department uses its own reference."
      >
        <TextInput
          id="custody-batch"
          value={batchRef}
          onChange={(event) => setBatchRef(event.target.value)}
          placeholder={suggestedBatchRef()}
          className="font-mono"
        />
      </Field>
      {direction === 'Intake' && (
        <Field label="Vendor / scanning agency" htmlFor="custody-vendor">
          <TextInput
            id="custody-vendor"
            value={vendor}
            onChange={(event) => setVendor(event.target.value)}
            placeholder="ScanServe"
          />
        </Field>
      )}
      <Field label="Remarks" htmlFor="custody-remarks">
        <TextArea
          id="custody-remarks"
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          placeholder="Optional"
          className="min-h-20"
        />
      </Field>
      <Button type="submit" disabled={!valid || busy} className="w-full">
        {busy ? 'Recording…' : 'Record handover'}
      </Button>
    </form>
  );
}

function CountForm({
  declared,
  onDone,
}: {
  declared: number;
  onDone: (count: number, note: string) => Promise<void>;
}) {
  const [count, setCount] = useState(String(declared));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const value = Number(count);
  const valid = Number.isFinite(value) && value >= 0;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy) return;
        setBusy(true);
        void onDone(value, note.trim()).finally(() => setBusy(false));
      }}
    >
      <p className="text-sm">
        The department declared <span className="font-mono font-semibold">{declared}</span> file(s).
      </p>
      <Field label="Files actually counted" htmlFor="custody-reconciled" required>
        <TextInput
          id="custody-reconciled"
          type="number"
          min={0}
          value={count}
          onChange={(event) => setCount(event.target.value)}
        />
      </Field>
      <Field label="Note" htmlFor="custody-reconcile-note">
        <TextArea
          id="custody-reconcile-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Why the counts differ, if they do"
          className="min-h-20"
        />
      </Field>
      <Button type="submit" disabled={!valid || busy} className="w-full">
        {busy ? 'Saving…' : 'Save counted total'}
      </Button>
    </form>
  );
}

function ReturnForm({
  event,
  onDone,
}: {
  event: CustodyEvent;
  onDone: (count: number, remarks: string) => Promise<void>;
}) {
  const expected = expectedOf(event);
  const remaining = remainingOf(event);
  const [count, setCount] = useState(String(remaining));
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  const value = Number(count);
  const valid = Number.isFinite(value) && value >= 1 && value <= remaining;

  return (
    <form
      className="space-y-4"
      onSubmit={(submit) => {
        submit.preventDefault();
        if (!valid || busy) return;
        setBusy(true);
        void onDone(value, remarks.trim()).finally(() => setBusy(false));
      }}
    >
      <p className="text-sm leading-6">
        {event.department} declared{' '}
        <span className="font-mono font-semibold">{event.fileCount}</span>
        {event.reconciledCount != null && (
          <>
            {' '}
            and <span className="font-mono font-semibold">{event.reconciledCount}</span> were
            counted
          </>
        )}
        ; <span className="font-mono font-semibold">{event.returnedCount ?? 0}</span> of{' '}
        <span className="font-mono font-semibold">{expected}</span> are already back, so{' '}
        <span className="font-mono font-semibold">{remaining}</span> are still out.
      </p>
      <Field
        label="Files returned now"
        htmlFor="custody-return-count"
        required
        hint={
          remaining > 1
            ? `Between 1 and ${remaining} — a partial return records part of the batch.`
            : undefined
        }
      >
        <TextInput
          id="custody-return-count"
          type="number"
          min={1}
          max={remaining}
          value={count}
          onChange={(event) => setCount(event.target.value)}
        />
      </Field>
      <Field label="Remarks" htmlFor="custody-return-remarks">
        <TextArea
          id="custody-return-remarks"
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          placeholder="Who received them, condition on arrival…"
          className="min-h-20"
        />
      </Field>
      <Button type="submit" disabled={!valid || busy} className="w-full">
        {busy ? 'Recording…' : 'Record return'}
      </Button>
    </form>
  );
}

function SignOffForm({
  defaultSigner,
  onDone,
}: {
  defaultSigner: string;
  onDone: (signer: string) => Promise<void>;
}) {
  const [signer, setSigner] = useState(defaultSigner);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        void onDone(signer.trim()).finally(() => setBusy(false));
      }}
    >
      <Field
        label="Signed off by"
        htmlFor="custody-signer"
        hint="Who certifies the handover — you, or the department officer present."
      >
        <TextInput
          id="custody-signer"
          value={signer}
          onChange={(event) => setSigner(event.target.value)}
          placeholder="Name"
        />
      </Field>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Signing…' : 'Sign off'}
      </Button>
    </form>
  );
}

/** The full record, including the return rows recorded against an intake. */
function CustodyDetails({ event, onClose }: { event: CustodyEvent; onClose: () => void }) {
  const service = useService();
  const { data: returns, loading } = useQuery(
    () =>
      event.direction === 'Intake' ? service.custody.returnsFor(event.id) : Promise.resolve([]),
    [event.id],
    [] as CustodyEvent[],
  );

  const rows: Array<[string, string]> = [
    ['Direction', event.direction === 'Intake' ? 'Intake in' : 'Return out'],
    ['Department', event.department],
    ['Batch', event.batchRef || '—'],
    ['Vendor / scanning agency', event.vendor || '—'],
    ['Declared files', String(event.fileCount)],
    [
      'Counted files',
      event.reconciledCount == null ? 'Not counted yet' : String(event.reconciledCount),
    ],
    ['Counted by', event.reconciledBy ?? '—'],
    ['Counted at', event.reconciledAt ?? '—'],
    [
      'Returned',
      event.direction === 'Intake'
        ? `${event.returnedCount ?? 0} of ${expectedOf(event)} back`
        : '—',
    ],
    ['Recorded by', event.recordedBy],
    ['Recorded at', event.recordedAt],
    ['Signed off by', event.signedOffBy ?? 'Not yet'],
    ['Signed off at', event.signedOffAt ?? '—'],
    ['Remarks', event.remarks || '—'],
  ];

  return (
    <div className="space-y-5">
      <dl className="divide-y divide-[var(--rr-border)] rounded-lg border border-base">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[140px_1fr] gap-3 px-4 py-2.5 text-[13px]">
            <dt className="muted">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>

      {event.direction === 'Intake' && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider muted">
            Returns against this batch
          </p>
          {loading ? (
            <p className="muted text-sm">Loading…</p>
          ) : returns.length === 0 ? (
            <p className="muted text-sm">
              None yet — use Return… on the register row when files go back.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--rr-border)] rounded-lg border border-base">
              {returns.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]"
                >
                  <Badge tone="neutral">{row.fileCount} file(s)</Badge>
                  <span className="muted text-xs">{row.recordedAt}</span>
                  <span className="muted text-xs">by {row.recordedBy}</span>
                  {row.signedOffBy && <Badge tone="success">signed off by {row.signedOffBy}</Badge>}
                  {row.remarks && <span className="muted w-full text-xs">{row.remarks}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Button variant="ghost" className="w-full" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

function RowActions({
  event,
  mayWrite,
  onCount,
  onSign,
  onReturn,
  onInspect,
  compact = false,
}: {
  event: CustodyEvent;
  mayWrite: boolean;
  onCount: (event: CustodyEvent) => void;
  onSign: (event: CustodyEvent) => void;
  onReturn: (event: CustodyEvent) => void;
  onInspect: (event: CustodyEvent) => void;
  compact?: boolean;
}) {
  const closed = event.signedOffAt !== null;
  const canCount = event.direction === 'Intake' && !closed;
  const canSign = !closed;
  // A return is recorded against an intake while files are still out — even
  // after the intake itself is signed off, the batch comes home later.
  const canReturn = event.direction === 'Intake' && remainingOf(event) > 0;
  const small = compact ? 'min-h-8 px-3 text-xs' : undefined;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        variant="ghost"
        size="sm"
        className={small}
        icon={<Eye size={compact ? 14 : 16} />}
        onClick={() => onInspect(event)}
        aria-label={`View the ${event.department} ${event.direction} details`}
      >
        {compact ? 'View' : ''}
      </Button>
      {mayWrite && canCount && (
        <Button
          variant="ghost"
          size="sm"
          className={small}
          icon={<Scales size={compact ? 14 : 16} />}
          onClick={() => onCount(event)}
        >
          Count…
        </Button>
      )}
      {mayWrite && canReturn && (
        <Button
          variant="ghost"
          size="sm"
          className={small}
          icon={<ArrowUDownLeft size={compact ? 14 : 16} />}
          onClick={() => onReturn(event)}
        >
          Return…
        </Button>
      )}
      {mayWrite && canSign && (
        <Button
          variant="ghost"
          size="sm"
          className={small}
          icon={<SealCheck size={compact ? 14 : 16} />}
          onClick={() => onSign(event)}
        >
          Sign off…
        </Button>
      )}
    </div>
  );
}
