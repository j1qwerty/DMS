import { useEffect, useState } from 'react';
import {
  ArrowCounterClockwise,
  CheckCircle,
  ClipboardText,
  MagnifyingGlass,
  Plus,
  Trash,
  X,
} from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Field, SelectInput, TextInput } from '../components/ui/Field';
import { StatusBadge } from '../components/ui/Flash';
import { RowSkeleton } from '../components/ui/Skeletons';
import { EmployeeCombobox } from '../components/EmployeeCombobox';
import { useFlash, useQuery, useService, useSession } from '../hooks/useService';
import { useScanAutoSubmit } from '../hooks/useScanAutoSubmit';
import { useFeatures } from '../lib/features';
import { cn } from '../lib/utils';
import type { Employee, IssueRecord, RecordFile } from '../types';
import type { BorrowerRow, Page } from '../services/contracts';

const EMPTY_FILES: Page<RecordFile> = { items: [], total: 0, page: 1, pageSize: 8 };
const EMPTY_RECEIPTS: Page<IssueRecord> = { items: [], total: 0, page: 1, pageSize: 50 };
const CONDITIONS = ['Good', 'Minor damage', 'Torn pages', 'Missing pages', 'Needs repair'];

function defaultDueDate(): string {
  const due = new Date();
  due.setDate(due.getDate() + 14);
  return due.toISOString().slice(0, 10);
}

/**
 * The issue & return desk, redesigned: the receipt log lives directly on the
 * page, and the two flows open on demand — the Issue files / Return files
 * buttons expand the matching section inline. No tabs, no hidden log: someone
 * glancing at the desk sees what is out, to whom, and what is due.
 */
export function IssueReturnDeskPage({
  initialSection = 'none',
}: {
  initialSection?: 'none' | 'issue' | 'return';
}) {
  const service = useService();
  const { allowed } = useSession();
  const { barcode } = useFeatures();

  const [section, setSection] = useState<'none' | 'issue' | 'return'>(initialSection);
  const [returnReceiptId, setReturnReceiptId] = useState('');

  const canIssue = allowed('issue.issue');
  const canReturn = allowed('issue.return');

  // The log itself — the desk's default view, always rendered.
  const {
    data: receipts,
    loading: loadingReceipts,
    reload: reloadReceipts,
  } = useQuery(() => service.issues.list({ pageSize: 50 }), [], EMPTY_RECEIPTS, ['issues']);

  const { data: borrowers, reload: reloadBorrowers } = useQuery(
    () => service.issues.borrowers(),
    [],
    [] as BorrowerRow[],
    ['issues'],
  );

  const openReceipt = (receipt: IssueRecord) => {
    setReturnReceiptId(receipt.id);
    setSection('return');
  };

  return (
    <div className="space-y-5">
      {/* Header + the two flow buttons */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Issue &amp; return desk</h1>
          <p className="muted mt-1 text-sm">
            {receipts.total > 0
              ? `${receipts.items.filter((r) => !r.returnedAt).length} open receipt(s) · ${receipts.total} in the log`
              : 'Issue registry files to borrowers and take them back — the log is right below.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<ClipboardText size={16} />}
            variant={section === 'issue' ? 'primary' : 'secondary'}
            onClick={() => setSection(section === 'issue' ? 'none' : 'issue')}
            aria-pressed={section === 'issue'}
          >
            {section === 'issue' ? 'Close issuing' : 'Issue files'}
          </Button>
          <Button
            icon={<ArrowCounterClockwise size={16} />}
            variant={section === 'return' ? 'primary' : 'secondary'}
            onClick={() => setSection(section === 'return' ? 'none' : 'return')}
            aria-pressed={section === 'return'}
          >
            {section === 'return' ? 'Close returning' : 'Return files'}
          </Button>
        </div>
      </div>

      {/* Expanded sections — only one at a time, right under the buttons. */}
      {section === 'issue' && (
        <IssueSection
          canIssue={canIssue}
          barcode={barcode}
          onIssued={() => {
            reloadReceipts();
            reloadBorrowers();
          }}
        />
      )}
      {section === 'return' && (
        <ReturnSection
          canReturn={canReturn}
          presetReceiptId={returnReceiptId}
          onPresetConsumed={() => setReturnReceiptId('')}
          onReturned={() => {
            reloadReceipts();
            reloadBorrowers();
          }}
        />
      )}

      {/* The log: receipts table + who still has files out. */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card padding={false} className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-base px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Receipt log</p>
              <p className="muted mt-0.5 text-xs">
                Latest {Math.min(receipts.items.length, 50)} receipt(s) — issue, part-return and
                return history
              </p>
            </div>
            <Badge tone="neutral">{receipts.total} total</Badge>
          </div>
          {loadingReceipts && receipts.items.length === 0 ? (
            <div className="p-4">
              <RowSkeleton rows={5} />
            </div>
          ) : receipts.items.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No receipts yet"
                description="Issue files from this desk — every receipt lands here with its due date."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-base text-xs uppercase tracking-wider text-[var(--rr-muted)]">
                    <th className="px-5 py-3 font-semibold">Receipt</th>
                    <th className="px-3 py-3 font-semibold">Borrower</th>
                    <th className="px-3 py-3 font-semibold">Files</th>
                    <th className="px-3 py-3 font-semibold">Issued</th>
                    <th className="px-3 py-3 font-semibold">Due</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--rr-border)]">
                  {receipts.items.map((receipt) => {
                    const out = receipt.lines.filter((line) => !line.returnedAt).length;
                    const open = !receipt.returnedAt;
                    return (
                      <tr key={receipt.id} className="transition hover:bg-[var(--rr-surface-2)]">
                        <td className="px-5 py-3.5">
                          <p className="font-mono text-[13px] font-semibold">
                            {receipt.receiptNumber}
                          </p>
                          <p className="muted mt-0.5 max-w-[16rem] truncate text-xs">
                            {receipt.purpose}
                          </p>
                        </td>
                        <td className="px-3 py-3.5">
                          <p className="text-[13px] font-semibold">{receipt.borrowerName}</p>
                          <p className="muted text-xs">{receipt.department || '—'}</p>
                        </td>
                        <td className="px-3 py-3.5 text-xs">
                          {open
                            ? `${out}/${receipt.lines.length} out`
                            : `${receipt.lines.length} returned`}
                        </td>
                        <td className="muted px-3 py-3.5 text-xs">
                          {new Date(receipt.issuedAt).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-3.5 text-xs">
                          {new Date(receipt.dueAt).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-3.5">
                          <StatusBadge status={receipt.status} />
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {open && canReturn ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => openReceipt(receipt)}
                            >
                              Return
                            </Button>
                          ) : (
                            <span className="muted text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card padding={false} className="overflow-hidden">
          <div className="border-b border-base px-5 py-4">
            <p className="text-sm font-semibold">Files still out</p>
            <p className="muted mt-0.5 text-xs">Borrowers with open receipts</p>
          </div>
          {borrowers.length === 0 ? (
            <p className="muted p-5 text-xs">Nothing is issued right now.</p>
          ) : (
            <ul className="divide-y divide-[var(--rr-border)]">
              {borrowers.map((row) => (
                <li key={row.employeeCode} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold">{row.name}</p>
                      <p className="muted text-xs">{row.department}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold">{row.openFiles} out</p>
                      {row.overdue ? (
                        <Badge tone="danger">overdue</Badge>
                      ) : (
                        <p className="muted text-[11px]">
                          due {new Date(row.oldestDue).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/** The expanded issue flow: build a cart, name the borrower, set terms. */
function IssueSection({
  canIssue,
  barcode,
  onIssued,
}: {
  canIssue: boolean;
  barcode: boolean;
  onIssued: () => void;
}) {
  const service = useService();
  const { success } = useFlash();

  const [scan, setScan] = useState('');
  const [fileSearch, setFileSearch] = useState('');
  const [cart, setCart] = useState<RecordFile[]>([]);
  const [borrowerType, setBorrowerType] = useState<'Employee' | 'Depositor'>('Employee');
  const [employeeText, setEmployeeText] = useState('');
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [depositorCode, setDepositorCode] = useState('');
  const [purpose, setPurpose] = useState('');
  const [dueAt, setDueAt] = useState(defaultDueDate());
  const [remark, setRemark] = useState('');
  const [error, setError] = useState('');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [committing, setCommitting] = useState(false);

  const { data: found } = useQuery(
    () =>
      fileSearch.trim().length >= 2
        ? service.files.list({ search: fileSearch.trim(), status: 'Available', pageSize: 8 })
        : Promise.resolve(EMPTY_FILES),
    [fileSearch.trim()],
    EMPTY_FILES,
  );

  const addScan = async (value: string) => {
    const query = value.trim();
    if (!query) return;
    try {
      const file = barcode ? await service.files.byBarcode(query) : null;
      const match = file ?? (await service.files.list({ search: query, pageSize: 1 })).items[0];
      if (!match) {
        setError(`No registry file matches “${query}”.`);
        return;
      }
      if (cart.some((row) => row.id === match.id)) {
        setError(`${match.fileNumber} is already on this receipt.`);
        return;
      }
      if (match.status !== 'Available') {
        setError(
          `${match.fileNumber} is ${match.status.toLowerCase()} — only available files can be issued.`,
        );
        return;
      }
      setError('');
      setCart((rows) => [...rows, match]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The scan could not be resolved.');
    }
  };

  const scanKeyDown = useScanAutoSubmit(scan, (value) => {
    setScan('');
    void addScan(value);
  });

  const removeFromCart = (id: string) => setCart((rows) => rows.filter((row) => row.id !== id));

  const commit = async () => {
    setCommitting(true);
    setError('');
    try {
      const result = await service.issues.issueFiles({
        borrowerType,
        borrowerEmployeeCode:
          borrowerType === 'Employee' ? (employee?.employeeCode ?? '') : depositorCode,
        borrowerName:
          borrowerType === 'Employee' ? (employee?.name ?? employeeText) : depositorCode,
        department: borrowerType === 'Employee' ? (employee?.department ?? '') : '',
        purpose,
        fileIds: cart.map((row) => row.id),
        dueAt,
        remark,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReceiptNumber(result.value.receiptNumber);
      setCart([]);
      setPurpose('');
      setRemark('');
      setEmployee(null);
      setEmployeeText('');
      setDepositorCode('');
      success(
        `Receipt ${result.value.receiptNumber} issued for ${result.value.lines.length} file(s).`,
      );
      onIssued();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The receipt could not be issued.');
    } finally {
      setCommitting(false);
    }
  };

  const borrowerReady =
    borrowerType === 'Employee'
      ? Boolean(employee?.employeeCode || employeeText.trim())
      : depositorCode.trim().length > 0;
  const canCommit =
    canIssue && cart.length > 0 && borrowerReady && purpose.trim().length > 0 && !committing;

  if (!canIssue) {
    return (
      <Card>
        <EmptyState
          title="Issuing needs the issue permission"
          description="Your role cannot issue files. The log below stays available read-only."
        />
      </Card>
    );
  }

  return (
    <Card>
      {receiptNumber && (
        <div className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-[color-mix(in_srgb,var(--rr-success)_40%,transparent)] bg-[color-mix(in_srgb,var(--rr-success)_8%,transparent)] p-3.5">
          <div className="flex items-start gap-2.5">
            <CheckCircle size={20} weight="fill" className="mt-0.5 text-[var(--rr-success)]" />
            <div>
              <p className="text-sm font-semibold">Receipt {receiptNumber} issued</p>
              <p className="muted text-xs">
                The files moved to Issued; the receipt is in the log below until everything is back.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setReceiptNumber('')}
            className="focus-ring muted rounded p-1 hover:text-[var(--rr-text)]"
            aria-label="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
        {/* 1 — the cart */}
        <div>
          <p className="text-sm font-semibold">
            1. Pick the files{' '}
            <span className="muted font-normal">({cart.length} on this receipt)</span>
          </p>

          <div className="mt-3 space-y-3">
            <TextInput
              value={scan}
              onChange={(event) => setScan(event.target.value)}
              onKeyDown={scanKeyDown}
              placeholder={barcode ? 'Scan a file barcode…' : 'Type a file number and press Enter…'}
              aria-label="Scan or type a file number"
            />
            <div className="relative">
              <MagnifyingGlass
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--rr-muted)]"
              />
              <TextInput
                value={fileSearch}
                onChange={(event) => setFileSearch(event.target.value)}
                placeholder="Search available files…"
                aria-label="Search available files"
                className="!pl-9"
              />
            </div>

            {fileSearch.trim().length >= 2 && found.items.length > 0 && (
              <ul className="divide-y divide-[var(--rr-border)] overflow-hidden rounded-xl border border-base">
                {found.items.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setCart((rows) =>
                          rows.some((r) => r.id === row.id) ? rows : [...rows, row],
                        );
                        setFileSearch('');
                      }}
                      className="focus-ring flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-[var(--rr-surface-2)]"
                    >
                      <span className="min-w-0">
                        <span className="block font-mono text-[13px] font-semibold">
                          {row.fileNumber}
                        </span>
                        <span className="muted block truncate text-xs">{row.subject}</span>
                      </span>
                      <Plus size={15} className="shrink-0 text-accent" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {cart.length > 0 && (
              <ul className="divide-y divide-[var(--rr-border)] overflow-hidden rounded-xl border border-base">
                {cart.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 p-3">
                    <span className="min-w-0">
                      <Link
                        to={`/files/${row.id}`}
                        className="focus-ring block font-mono text-[13px] font-semibold text-accent"
                      >
                        {row.fileNumber}
                      </Link>
                      <span className="muted block truncate text-xs">{row.subject}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFromCart(row.id)}
                      className="focus-ring muted rounded p-1.5 hover:text-[var(--rr-danger)]"
                      aria-label={`Remove ${row.fileNumber}`}
                    >
                      <Trash size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 2 — borrower and terms */}
        <div>
          <p className="text-sm font-semibold">2. Borrower and terms</p>
          <div className="mt-3 space-y-4">
            <div className="flex w-fit rounded-lg border border-base bg-[var(--rr-bg)] p-1">
              {(['Employee', 'Depositor'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setBorrowerType(type)}
                  className={cn(
                    'focus-ring min-h-8 rounded-md px-3 text-xs font-semibold transition',
                    borrowerType === type
                      ? 'bg-[var(--rr-accent-fill)] text-white'
                      : 'muted hover:text-[var(--rr-text)]',
                  )}
                >
                  {type}
                </button>
              ))}
            </div>

            {borrowerType === 'Employee' ? (
              <EmployeeCombobox
                text={employeeText}
                selected={employee}
                onTextChange={setEmployeeText}
                onSelect={(picked) => {
                  setEmployee(picked);
                  setEmployeeText(picked?.name ?? '');
                }}
                onClear={() => {
                  setEmployee(null);
                  setEmployeeText('');
                }}
                label="Borrower (employee)"
                hint="Pick from the list, or leave a typed name for an unregistered employee."
              />
            ) : (
              <Field label="Depositor code" htmlFor="issue-depositor" required>
                <TextInput
                  id="issue-depositor"
                  value={depositorCode}
                  onChange={(event) => setDepositorCode(event.target.value)}
                  placeholder="Depositor ID or name"
                />
              </Field>
            )}

            <Field label="Purpose" htmlFor="issue-purpose" required>
              <TextInput
                id="issue-purpose"
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                placeholder="Why these files are being issued"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Due date" htmlFor="issue-due" required>
                <TextInput
                  id="issue-due"
                  type="date"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                />
              </Field>
              <Field label="Remark" htmlFor="issue-remark">
                <TextInput
                  id="issue-remark"
                  value={remark}
                  onChange={(event) => setRemark(event.target.value)}
                  placeholder="Optional"
                />
              </Field>
            </div>

            {error && (
              <p className="rounded-lg border border-[color-mix(in_srgb,var(--rr-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--rr-danger)_8%,transparent)] p-2.5 text-xs font-medium text-[var(--rr-danger)]">
                {error}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                onClick={() => void commit()}
                disabled={!canCommit}
                icon={<ClipboardText size={16} />}
              >
                {committing ? 'Issuing…' : `Issue ${cart.length} file(s)`}
              </Button>
            </div>
            <p className="muted text-[11px] leading-5">
              Guards applied server-side: every file must exist and be Available, no duplicates on
              one receipt, and the due date cannot be in the past.
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** The expanded return flow: pick a receipt, tick what came back, condition. */
function ReturnSection({
  canReturn,
  presetReceiptId,
  onPresetConsumed,
  onReturned,
}: {
  canReturn: boolean;
  presetReceiptId: string;
  onPresetConsumed: () => void;
  onReturned: () => void;
}) {
  const service = useService();
  const { success } = useFlash();
  const [receiptSearch, setReceiptSearch] = useState('');
  const [receiptId, setReceiptId] = useState(presetReceiptId);
  const [selected, setSelected] = useState<string[]>([]);
  const [condition, setCondition] = useState('Good');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [prevPresetReceiptId, setPrevPresetReceiptId] = useState(presetReceiptId);
  if (presetReceiptId && presetReceiptId !== prevPresetReceiptId) {
    setPrevPresetReceiptId(presetReceiptId);
    setReceiptId(presetReceiptId);
    setSelected([]);
  }

  // A receipt chosen from the log arrives as a preset; notify the parent it was consumed.
  useEffect(() => {
    if (presetReceiptId) {
      onPresetConsumed();
    }
  }, [presetReceiptId, onPresetConsumed]);

  const { data: openReceipts, loading: loadingReceipts } = useQuery(
    () => service.issues.list({ open: true, borrower: receiptSearch.trim(), pageSize: 100 }),
    [receiptSearch.trim()],
    EMPTY_RECEIPTS,
    ['issues'],
  );

  const {
    data: receiptView,
    loading: loadingReceipt,
    reload: reloadReceipt,
  } = useQuery(
    async () => {
      if (!receiptId) return null;
      const record = await service.issues.get(receiptId);
      if (!record) return null;
      const files = await Promise.all(record.lines.map((line) => service.files.get(line.fileId)));
      return { record, files };
    },
    [receiptId],
    null,
  );

  const toggleLine = (fileId: string, alreadyBack: boolean) => {
    if (alreadyBack) return;
    setSelected((rows) =>
      rows.includes(fileId) ? rows.filter((id) => id !== fileId) : [...rows, fileId],
    );
  };

  const commit = async () => {
    if (!receiptView || selected.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const result = await service.issues.returnFiles(receiptView.record.id, selected, condition);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const all = result.value.returnedAt !== null;
      success(
        all
          ? `Receipt ${result.value.receiptNumber} fully returned.`
          : `Part-returned receipt ${result.value.receiptNumber}.`,
      );
      setSelected([]);
      onReturned();
      reloadReceipt();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The return could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  if (!canReturn) {
    return (
      <Card>
        <EmptyState
          title="Returning needs the return permission"
          description="Your role cannot take files back. The log below stays available read-only."
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]">
        {/* 1 — pick the receipt */}
        <div>
          <p className="text-sm font-semibold">1. Pick an open receipt</p>
          <div className="mt-3 space-y-3">
            <div className="relative">
              <MagnifyingGlass
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--rr-muted)]"
              />
              <TextInput
                value={receiptSearch}
                onChange={(event) => setReceiptSearch(event.target.value)}
                placeholder="Search by borrower…"
                aria-label="Search open receipts"
                className="!pl-9"
              />
            </div>
            {loadingReceipts ? (
              <RowSkeleton rows={3} />
            ) : openReceipts.items.length === 0 ? (
              <p className="muted text-xs">No open receipt matches.</p>
            ) : (
              <ul className="max-h-72 divide-y divide-[var(--rr-border)] overflow-y-auto overflow-x-hidden rounded-xl border border-base">
                {openReceipts.items.map((receipt) => (
                  <li key={receipt.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setReceiptId(receipt.id);
                        setSelected([]);
                      }}
                      className={cn(
                        'focus-ring flex w-full items-center justify-between gap-3 p-3 text-left transition',
                        receiptId === receipt.id
                          ? 'bg-accent-soft/40 border-l-[3px] border-[var(--rr-accent)]'
                          : 'hover:bg-[var(--rr-surface-2)] border-l-[3px] border-transparent',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block font-mono text-[13px] font-semibold">
                          {receipt.receiptNumber}
                        </span>
                        <span className="muted block truncate text-xs">
                          {receipt.borrowerName} · due{' '}
                          {new Date(receipt.dueAt).toLocaleDateString()}
                        </span>
                      </span>
                      <StatusBadge status={receipt.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted text-xs">
              {openReceipts.items.filter((r) => !r.returnedAt).length} open receipt(s) ·{' '}
              {openReceipts.items.reduce(
                (sum, r) => sum + r.lines.filter((l) => !l.returnedAt).length,
                0,
              )}{' '}
              file(s) still out
            </p>
          </div>
        </div>

        {/* 2 — confirm what came back */}
        <div>
          <p className="text-sm font-semibold">2. Confirm what came back</p>
          {!receiptId ? (
            <p className="muted mt-3 text-xs">Pick a receipt on the left.</p>
          ) : loadingReceipt || !receiptView ? (
            <div className="mt-3">
              <RowSkeleton rows={3} />
            </div>
          ) : (
            <div className="mt-3 space-y-4">
              <div className="rounded-xl bg-[var(--rr-bg)] p-3.5">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {receiptView.record.receiptNumber}
                  <StatusBadge status={receiptView.record.status} />
                </p>
                <p className="muted mt-1 text-xs">
                  {receiptView.record.borrowerName} · {receiptView.record.purpose} · issued{' '}
                  {new Date(receiptView.record.issuedAt).toLocaleDateString()} · due{' '}
                  {new Date(receiptView.record.dueAt).toLocaleDateString()}
                </p>
              </div>

              <ul className="divide-y divide-[var(--rr-border)] overflow-hidden rounded-xl border border-base">
                {receiptView.record.lines.map((line, index) => {
                  const file = receiptView.files[index];
                  const alreadyBack = line.returnedAt !== null;
                  return (
                    <li key={line.fileId}>
                      <label
                        className={cn(
                          'flex cursor-pointer items-center gap-3 p-3 text-sm transition',
                          alreadyBack ? 'opacity-60' : 'hover:bg-[var(--rr-surface-2)]',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--rr-accent)]"
                          checked={alreadyBack || selected.includes(line.fileId)}
                          disabled={alreadyBack}
                          onChange={() => toggleLine(line.fileId, alreadyBack)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-[13px] font-semibold">
                            {file?.fileNumber ?? line.fileBarcode}
                          </span>
                          <span className="muted block truncate text-xs">
                            {file?.subject ?? ''}
                          </span>
                        </span>
                        {alreadyBack && <Badge tone="success">returned</Badge>}
                      </label>
                    </li>
                  );
                })}
              </ul>

              <Field label="Condition of the returned files" htmlFor="return-condition">
                <SelectInput
                  id="return-condition"
                  value={condition}
                  onChange={(event) => setCondition(event.target.value)}
                  className="sm:max-w-[240px]"
                >
                  {CONDITIONS.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </SelectInput>
              </Field>

              {error && (
                <p className="rounded-lg border border-[color-mix(in_srgb,var(--rr-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--rr-danger)_8%,transparent)] p-2.5 text-xs font-medium text-[var(--rr-danger)]">
                  {error}
                </p>
              )}

              <div className="flex justify-end">
                <Button
                  onClick={() => void commit()}
                  disabled={selected.length === 0 || busy}
                  icon={<ArrowCounterClockwise size={16} />}
                >
                  {busy ? 'Returning…' : `Return ${selected.length} file(s)`}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
