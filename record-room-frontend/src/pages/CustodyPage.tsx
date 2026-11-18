import { useState } from 'react';
import { DownloadSimple, MagnifyingGlass, Plus, Scales, SealCheck } from '@phosphor-icons/react';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { Field, SelectInput, TextArea, TextInput } from '../components/ui/Field';
import { EmptyState } from '../components/ui/EmptyState';
import { TableSkeleton } from '../components/ui/Skeletons';
import { useFlash, useQuery, useService, useSession } from '../hooks/useService';
import { downloadCsv, toCsv } from '../lib/csv';
import type { CustodyDirection, CustodyEvent } from '../types';
import type { Page } from '../services/contracts';

const EMPTY_PAGE: Page<CustodyEvent> = { items: [], total: 0, page: 1, pageSize: 50 };
const DIRECTIONS = ['All', 'Intake', 'Return'] as const;

/** Declared minus counted; null until the intake side has been counted. */
function varianceOf(event: CustodyEvent): number | null {
  return event.reconciledCount == null ? null : event.reconciledCount - event.fileCount;
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
    <span className="flex items-center gap-2">
      <span className="font-mono text-[13px]">{event.reconciledCount}</span>
      {variance !== 0 && (
        <Badge tone={variance > 0 ? 'info' : 'danger'}>
          {variance > 0 ? `+${variance} extra` : `${variance} short`}
        </Badge>
      )}
    </span>
  );
}

function StateCell({ event }: { event: CustodyEvent }) {
  if (event.signedOffAt) {
    return <Badge tone="success">Signed off</Badge>;
  }
  return <Badge tone="warning">Open</Badge>;
}

/**
 * The digitization custody register (work plan §3.8): one page for both
 * directions — an intake records what a department handed over and what was
 * actually counted (the reconciliation), a return records the handover back.
 * Rows are immutable, so the only actions are record, count and sign off.
 */
export function CustodyPage() {
  const service = useService();
  const { allowed, user } = useSession();
  const { success, danger } = useFlash();

  const [direction, setDirection] = useState<(typeof DIRECTIONS)[number]>('All');
  const [search, setSearch] = useState('');
  const [recording, setRecording] = useState(false);
  const [counting, setCounting] = useState<CustodyEvent | null>(null);
  const [signing, setSigning] = useState<CustodyEvent | null>(null);

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
      'Variance',
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
      varianceOf(event) ?? '',
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
    <div className="space-y-7">
      <PageHeader
        kicker="Digitization"
        title="Custody register"
        description="The custody chain both ways: what each department handed over and what was actually counted, plus the return handover sign-off. Rows are never edited — a correction is a new row."
        actions={
          mayWrite && (
            <Button icon={<Plus size={17} />} onClick={() => setRecording(true)}>
              Record handover…
            </Button>
          )
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
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-[var(--rr-bg)] text-xs uppercase tracking-wider muted">
                  <tr>
                    <th className="px-4 py-3">Recorded</th>
                    <th className="px-4 py-3">Direction</th>
                    <th className="px-4 py-3">Department</th>
                    <th className="px-4 py-3">Batch / vendor</th>
                    <th className="px-4 py-3">Declared</th>
                    <th className="px-4 py-3">Counted</th>
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
                        <StateCell event={event} />
                      </td>
                      <td className="px-4 py-3">
                        {mayWrite && (
                          <RowActions event={event} onCount={setCounting} onSign={setSigning} />
                        )}
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
                  </p>
                  {event.remarks && <p className="muted mt-1 text-xs leading-5">{event.remarks}</p>}
                  {mayWrite && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <RowActions event={event} onCount={setCounting} onSign={setSigning} compact />
                    </div>
                  )}
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
    </div>
  );
}

type RecordInput = Parameters<ReturnType<typeof useService>['custody']['record']>[0];

function RecordForm({ onDone }: { onDone: (input: RecordInput) => Promise<void> }) {
  const [direction, setDirection] = useState<CustodyDirection>('Intake');
  const [department, setDepartment] = useState('');
  const [batchRef, setBatchRef] = useState('');
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
      <Field label="Department" htmlFor="custody-department" required>
        <TextInput
          id="custody-department"
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
          placeholder="Establishment"
        />
      </Field>
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
        hint="Optional batch or reference the handover belongs to."
      >
        <TextInput
          id="custody-batch"
          value={batchRef}
          onChange={(event) => setBatchRef(event.target.value)}
          placeholder="DIG-2026-05"
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

function RowActions({
  event,
  onCount,
  onSign,
  compact = false,
}: {
  event: CustodyEvent;
  onCount: (event: CustodyEvent) => void;
  onSign: (event: CustodyEvent) => void;
  compact?: boolean;
}) {
  const closed = event.signedOffAt !== null;
  const canCount = event.direction === 'Intake' && !closed;
  const canSign = !closed;

  if (closed || (!canCount && !canSign)) {
    return <span className="muted text-xs">Closed</span>;
  }

  return (
    <>
      {canCount && (
        <Button
          variant="ghost"
          size="sm"
          className={compact ? 'min-h-8 px-3 text-xs' : undefined}
          icon={<Scales size={compact ? 14 : 16} />}
          onClick={() => onCount(event)}
        >
          Count…
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className={compact ? 'min-h-8 px-3 text-xs' : undefined}
        icon={<SealCheck size={compact ? 14 : 16} />}
        onClick={() => onSign(event)}
      >
        Sign off…
      </Button>
    </>
  );
}
