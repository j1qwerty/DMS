import { useEffect, useState } from 'react';
import { ArrowRight, MagnifyingGlass, Plus, Scan, Stack } from '@phosphor-icons/react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { TextInput } from '../components/ui/Field';
import { EmptyState } from '../components/ui/EmptyState';
import { RowSkeleton } from '../components/ui/Skeletons';
import { StatusBadge } from '../components/ui/Flash';
import { useQuery, useService, useSession } from '../hooks/useService';
import type { AuditEntry, CustodyEvent, DocumentDerivative, RecordFile } from '../types';
import type { FileDigitizationProgress, Page } from '../services/contracts';
import { CustodyRegister } from './CustodyPage';

const EMPTY_PROGRESS: FileDigitizationProgress[] = [];
const EMPTY_CUSTODY: Page<CustodyEvent> = { items: [], total: 0, page: 1, pageSize: 200 };
const EMPTY_AUDIT: AuditEntry[] = [];

/**
 * The Digitization section (round 5): the operator's home. The worklist tab
 * tracks every file on the desk — pages scanned, reviewed, rejected, builds
 * pending — and the batches tab is the custody register (the intake and return
 * handovers the departments' physical files travel in). Scanning itself
 * happens in the studio, one file at a time, opened from either tab.
 *
 * The pending-review queue that used to live here is its own Review section.
 */
export function DigitizationPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { allowed } = useSession();
  const rawTab = params.get('tab');
  const tab: 'worklist' | 'custody' = rawTab === 'custody' ? 'custody' : 'worklist';
  const [workbench, setWorkbench] = useState(rawTab === 'studio');

  // Old links: the queue tab became the Review section; the studio tab opened
  // the same picker the button opens.
  useEffect(() => {
    if (rawTab === 'queue') navigate('/review', { replace: true });
  }, [rawTab, navigate]);

  const setTab = (next: 'worklist' | 'custody') => {
    const search = new URLSearchParams(params);
    if (next === 'custody') search.set('tab', next);
    else search.delete('tab');
    setParams(search, { replace: true });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Digitization sections"
          className="flex w-full gap-1 rounded-xl border border-base bg-[var(--rr-surface)] p-1 sm:w-auto sm:self-start"
        >
          {(
            [
              ['worklist', 'Worklist'],
              ['custody', 'Batches'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`focus-ring min-h-10 flex-1 rounded-lg px-4 text-sm font-semibold transition sm:flex-none ${
                tab === key
                  ? 'bg-[var(--rr-accent-fill)] text-white'
                  : 'muted hover:bg-[var(--rr-surface-2)] hover:text-[var(--rr-text)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {allowed('studio.use') && (
          <Button
            icon={<Plus size={17} weight="bold" />}
            className="sm:shrink-0"
            onClick={() => setWorkbench(true)}
          >
            New digitization…
          </Button>
        )}
      </div>

      {tab === 'worklist' ? (
        <Worklist onOpenStudio={() => setWorkbench(true)} />
      ) : (
        <CustodyRegister />
      )}

      <Modal
        open={workbench}
        onClose={() => setWorkbench(false)}
        title="New digitization"
        description="Pick the file to digitize — the studio opens next."
      >
        <WorkbenchPicker
          onOpenFile={(fileId) => {
            setWorkbench(false);
            navigate(`/files/${fileId}/studio`);
          }}
        />
      </Modal>
    </div>
  );
}

/**
 * The file picker of the workbench: searches the registry as you type. The
 * digitization operator works file by file, so this is the one decision that
 * starts a session.
 */
function WorkbenchPicker({ onOpenFile }: { onOpenFile: (fileId: string) => void }) {
  const service = useService();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<RecordFile[]>([]);

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void service.files
        .list({ search: term.trim() || undefined, pageSize: 8 })
        .then((page) => {
          if (live) setResults(page.items);
        })
        .catch(() => {
          if (live) setResults([]);
        });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [term, service]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <MagnifyingGlass
          size={18}
          className="muted pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
        />
        <TextInput
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="File number or subject…"
          aria-label="Search the registry for the file to digitize"
          className="pl-10"
          autoFocus
        />
      </div>

      {results.length === 0 ? (
        <p className="muted text-sm">
          No matching file. Register it first — the studio opens straight after creation.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--rr-border)] rounded-xl border border-base">
          {results.map((file) => (
            <li key={file.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-[13px] font-semibold text-accent">
                  {file.fileNumber}
                </p>
                <p className="muted mt-0.5 truncate text-xs">{file.subject}</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<Scan size={15} />}
                onClick={() => onOpenFile(file.id)}
              >
                Open studio
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Link
        to="/files/new?intent=digitize"
        className="focus-ring flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-base text-sm font-semibold text-accent hover:bg-accent-soft"
      >
        <Plus size={16} weight="bold" /> Register a new file to digitize
      </Link>
    </div>
  );
}

/** One compact figure; the strip answers "what is on my desk" at a glance. */
function StatFigure({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="muted text-xs">{label}</p>
    </div>
  );
}

/**
 * The worklist: one row per file under digitization, with its progress. The
 * numbers come from the service's `progress()` aggregation, so both adapters
 * can answer it; pending counts double as the reviewer backlog.
 */
function Worklist({ onOpenStudio }: { onOpenStudio: () => void }) {
  const service = useService();
  const { allowed } = useSession();
  const [search, setSearch] = useState('');

  const { data: rows, loading } = useQuery(
    () => service.digitization.progress({ search }),
    [search],
    EMPTY_PROGRESS,
    ['digitization'],
  );

  const { data: pendingReviews } = useQuery(
    () => service.digitization.pendingReviewCount(),
    [],
    0,
    ['digitization'],
  );

  const { data: pendingPdfs } = useQuery(
    () => service.digitization.pendingPdfs({}),
    [],
    [] as DocumentDerivative[],
    ['digitization'],
  );

  const { data: custody } = useQuery(
    () => service.custody.list({ direction: 'Intake', pageSize: 200 }),
    [],
    EMPTY_CUSTODY,
    // Custody writes land on the digitization channel from every desk.
    ['digitization'],
  );

  const { data: recent } = useQuery(
    () => service.audit.list({ group: 'digitization', limit: 6 }),
    [],
    EMPTY_AUDIT,
    ['audit'],
  );

  const openBatches = custody.items.filter((event) => !event.signedOffAt).length;
  const totalPages = rows.reduce((sum, row) => sum + row.pagesTotal, 0);
  const approvedPages = rows.reduce((sum, row) => sum + row.pagesApproved, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <StatFigure value={String(rows.length)} label="Files on the desk" />
        </Card>
        <Card>
          <StatFigure value={`${approvedPages}/${totalPages}`} label="Pages approved" />
        </Card>
        <Card>
          <StatFigure value={String(pendingReviews)} label="Pages awaiting review" />
        </Card>
        <Card>
          <StatFigure value={String(pendingPdfs.length)} label="Builds awaiting approval" />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card padding={false} className="overflow-hidden">
          <div className="border-b border-base p-4">
            <TextInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="File number, barcode, subject or department…"
              aria-label="Search the worklist"
            />
          </div>

          {loading && rows.length === 0 ? (
            <div className="p-4">
              <RowSkeleton rows={5} />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={search ? 'No file matches this search' : 'No files under digitization'}
                description={
                  search
                    ? 'Try another term, or clear the search.'
                    : 'Files appear here once a department sends a batch (Batches tab) or a page is scanned in the studio.'
                }
                action={
                  !search &&
                  allowed('studio.use') && (
                    <Button size="sm" icon={<Scan size={15} />} onClick={onOpenStudio}>
                      Start a digitization
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--rr-border)]">
              {rows.map((row) => {
                const approvedPct =
                  row.pagesTotal > 0 ? Math.round((row.pagesApproved / row.pagesTotal) * 100) : 0;
                return (
                  <li key={row.fileId} className="p-4 sm:p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 lg:w-72">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/files/${row.fileId}`}
                            className="focus-ring font-mono text-[13px] font-semibold text-accent"
                          >
                            {row.fileNumber || row.fileBarcode}
                          </Link>
                          <StatusBadge status={row.status ?? 'Available'} />
                        </div>
                        <p className="mt-0.5 truncate text-sm font-medium">{row.subject}</p>
                        {row.department && (
                          <p className="muted mt-0.5 truncate text-xs">{row.department}</p>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        {row.pagesTotal === 0 ? (
                          <p className="muted text-xs">No pages scanned yet</p>
                        ) : (
                          <>
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="font-semibold">
                                {row.pagesApproved}/{row.pagesTotal} pages approved
                              </span>
                              <span className="muted">
                                {row.pagesPending} pending · {row.pagesRejected} rejected
                              </span>
                            </div>
                            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--rr-surface-2)]">
                              <div
                                className="h-full rounded-full bg-[var(--rr-accent)] transition-all"
                                style={{ width: `${approvedPct}%` }}
                              />
                            </div>
                          </>
                        )}
                        {row.deliverables > 0 && (
                          <p className="mt-1.5 text-xs">
                            <span className="font-semibold">{row.deliverables}</span>{' '}
                            <span className="muted">deliverable build(s)</span>
                            {row.deliverablesPending > 0 && (
                              <Badge tone="warning">{row.deliverablesPending} pending</Badge>
                            )}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 flex-col items-start gap-1 lg:items-end">
                        {row.lastActivityAt && (
                          <span className="muted text-[11px]">
                            {new Date(row.lastActivityAt).toLocaleString()}
                          </span>
                        )}
                        <div className="flex gap-2">
                          <Link
                            to={`/files/${row.fileId}`}
                            className="focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-base px-3 text-xs font-semibold hover:bg-[var(--rr-surface-2)]"
                          >
                            View
                          </Link>
                          {allowed('studio.use') && (
                            <Link
                              to={`/files/${row.fileId}/studio`}
                              className="focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[var(--rr-accent-fill)] px-3 text-xs font-semibold text-white hover:opacity-90"
                            >
                              <Scan size={14} /> Open studio
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Open batches</p>
              <Link
                to="/digitization?tab=custody"
                className="focus-ring inline-flex items-center gap-1 text-xs font-semibold text-accent"
              >
                Batches <ArrowRight size={12} />
              </Link>
            </div>
            <p className="mt-3 text-2xl font-bold tabular-nums">{openBatches}</p>
            <p className="muted text-xs">intake batches still out with digitization</p>
          </Card>

          <Card padding={false} className="overflow-hidden">
            <div className="border-b border-base p-4">
              <p className="text-sm font-semibold">Recent activity</p>
            </div>
            {recent.length === 0 ? (
              <p className="muted p-4 text-xs">No digitization activity recorded yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--rr-border)]">
                {recent.map((entry) => (
                  <li key={entry.id} className="px-4 py-3">
                    <p className="text-xs font-medium leading-5">{entry.summary}</p>
                    <p className="muted mt-0.5 text-[11px]">
                      {entry.actor} · {new Date(entry.at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex items-center gap-2">
              <Stack size={18} className="text-accent" />
              <p className="text-sm font-semibold">How the desk works</p>
            </div>
            <ol className="muted mt-3 space-y-2 text-xs leading-5">
              <li>1. Record the department's intake under Batches and count the files.</li>
              <li>2. Open a file in the studio, scan or upload its pages, fill the metadata.</li>
              <li>3. Build the deliverable PDF; it waits for approval in Review.</li>
              <li>4. Return the batch when the department takes its files back.</li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
