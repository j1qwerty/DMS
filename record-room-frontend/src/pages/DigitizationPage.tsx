import { useEffect, useState, type ReactNode } from 'react';
import {
  CheckCircle,
  Eye,
  MagnifyingGlass,
  Plus,
  Scan,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Field, TextArea, TextInput } from '../components/ui/Field';
import { EmptyState } from '../components/ui/EmptyState';
import { RowSkeleton } from '../components/ui/Skeletons';
import { DocumentViewer } from '../components/files/DocumentViewer';
import { useFlash, useQuery, useService, useSession } from '../hooks/useService';
import type { FileScan, RecordFile } from '../types';
import { CustodyRegister } from './CustodyPage';

/**
 * The Digitization section, one page in tabs (round 3): the pending-review
 * queue and the custody register are the two halves of the scan pipeline, so
 * they sit behind one menu entry. The tab lives in the URL (?tab=custody), so
 * a link can open either half directly.
 *
 * Round 4: no page header — the tabs are the top element — and the queue rows
 * preview their scan. "New digitization…" is the workbench entry: pick a
 * registered file or register a new one, then scan, compose and build the PDF
 * in the studio.
 */
export function DigitizationPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { allowed } = useSession();
  const tab = params.get('tab') === 'custody' ? 'custody' : 'queue';
  const [workbench, setWorkbench] = useState(false);

  const setTab = (next: 'queue' | 'custody') => {
    const search = new URLSearchParams(params);
    if (next === 'custody') search.set('tab', 'custody');
    else search.delete('tab');
    setParams(search, { replace: true });
  };

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Digitization sections"
          className="flex w-full gap-1 rounded-xl border border-base bg-[var(--rr-surface)] p-1 sm:w-auto sm:self-start"
        >
          {(
            [
              ['queue', 'Scan review queue'],
              ['custody', 'Custody register'],
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

      {tab === 'queue' ? <ScanReviewQueue /> : <CustodyRegister />}

      <Modal
        open={workbench}
        onClose={() => setWorkbench(false)}
        title="New digitization"
        description="Pick the registered file to digitize, or register a new one — the studio opens next, where you scan or upload the pages, compose them and build the deliverable PDF."
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

/**
 * File-centric digitization (2026-10-28 decision): the Digitization section is
 * the pending-review queue across files. Pages are added from the file page or
 * the studio; here a supervisor reviews them — approve, or reject with a reason.
 */
function ScanReviewQueue() {
  const service = useService();
  const { allowed } = useSession();

  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState('');
  const [rejecting, setRejecting] = useState<FileScan | null>(null);
  const [previewing, setPreviewing] = useState<FileScan | null>(null);
  const { success, danger } = useFlash();

  // The API owns the filtering; the rows on screen are exactly the pending
  // queue for the current search. Live updates from other screens arrive on
  // the 'digitization' channel.
  const {
    data: queue,
    loading,
    reload,
  } = useQuery(() => service.digitization.pending({ search }), [search], [] as FileScan[], [
    'digitization',
  ]);

  const review = async (scan: FileScan, decision: 'Approved' | 'Rejected', note = '') => {
    setBusyId(scan.id);
    try {
      const result = await service.digitization.review(scan.id, decision, note);
      if (!result.ok) {
        danger(result.error);
        return;
      }
      success(`${scan.filename} ${decision.toLowerCase()}.`);
      reload();
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Metric icon={<Scan />} label="In queue" value={String(queue.length)} />
        <Metric
          icon={<WarningCircle />}
          label="Reviewer"
          value={allowed('digitization.review') ? 'Supervisor+ only' : 'Read-only for you'}
          tone="warning"
          hint="Approve, or reject with a reason."
        />
      </div>

      <Card padding={false} className="overflow-hidden">
        <div className="border-b border-base p-4">
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="File barcode, file number or scan name…"
            aria-label="Search the review queue"
          />
        </div>

        {loading && queue.length === 0 ? (
          <RowSkeleton rows={6} />
        ) : queue.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Nothing awaits review"
              description="Add page scans from a file page or the studio; they appear here for review."
              action={
                <Link to="/files" className="focus-ring text-xs font-semibold text-accent">
                  Open the registry
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--rr-border)]">
            {queue.map((scan) => (
              <li key={scan.id} className="p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="break-all font-semibold">{scan.filename}</p>
                    <p className="muted mt-1 text-[11px]">
                      Page {scan.pageNo} · v{scan.version} · {scan.documentSize} · uploaded{' '}
                      {scan.uploadedAt} by {scan.uploadedBy}
                    </p>
                    <p className="muted mt-1 text-[11px]">
                      File{' '}
                      <Link
                        to={`/files/${scan.fileId}`}
                        className="focus-ring font-mono text-accent"
                      >
                        {scan.fileNumber || scan.fileBarcode}
                      </Link>{' '}
                      · {scan.fileBarcode}
                    </p>
                    {scan.note && <p className="muted mt-1 text-[11px]">{scan.note}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      icon={<Eye size={16} />}
                      disabled={!scan.hasDocument}
                      onClick={() => setPreviewing(scan)}
                    >
                      Preview
                    </Button>
                    {allowed('digitization.review') && (
                      <>
                        <Button
                          icon={<CheckCircle size={16} />}
                          disabled={busyId === scan.id}
                          onClick={() => void review(scan, 'Approved')}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="ghost"
                          icon={<XCircle size={16} />}
                          disabled={busyId === scan.id}
                          onClick={() => setRejecting(scan)}
                        >
                          Reject…
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={previewing !== null}
        onClose={() => setPreviewing(null)}
        title={`Scan preview — ${previewing?.filename ?? ''}`}
        description={
          previewing
            ? `Page ${previewing.pageNo} · v${previewing.version} of ${previewing.fileBarcode}`
            : undefined
        }
      >
        {previewing && (
          <DocumentViewer
            docKey={previewing.id}
            load={() => service.digitization.scanBlob(previewing.id)}
            filename={previewing.filename}
            contentType={previewing.contentType}
            pageIndex={previewing.pageIndex}
            fill
          />
        )}
      </Modal>

      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={`Reject ${rejecting?.filename ?? ''}`}
      >
        {rejecting && (
          <RejectForm
            onSubmit={async (note) => {
              await review(rejecting, 'Rejected', note);
              setRejecting(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'warning';
}) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <div
          className={`rounded-lg p-2 ${tone === 'warning' ? 'text-[var(--rr-warning)]' : 'text-accent'}`}
          style={
            tone === 'warning'
              ? { background: 'color-mix(in srgb, var(--rr-warning) 12%, transparent)' }
              : undefined
          }
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="muted text-[10px] uppercase tracking-wider">{label}</p>
          <p className="mt-1 text-xl font-semibold">{value}</p>
          {hint && <p className="muted mt-0.5 text-[10px]">{hint}</p>}
        </div>
      </div>
    </Card>
  );
}

function RejectForm({ onSubmit }: { onSubmit: (note: string) => void }) {
  const [note, setNote] = useState('');

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(note);
      }}
    >
      <Field label="Rejection reason" htmlFor="reject-note" required>
        <TextArea
          id="reject-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Skew beyond tolerance, missing half the page…"
        />
      </Field>
      <Button type="submit" disabled={!note.trim()}>
        Reject page
      </Button>
    </form>
  );
}
