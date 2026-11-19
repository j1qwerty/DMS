import { useEffect, useState, type ReactNode } from 'react';
import {
  CheckCircle,
  Eye,
  FilePdf,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Scan,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Field, TextArea, TextInput } from '../components/ui/Field';
import { EmptyState } from '../components/ui/EmptyState';
import { RowSkeleton } from '../components/ui/Skeletons';
import { DocumentViewer } from '../components/files/DocumentViewer';
import { useFlash, useQuery, useService, useSession } from '../hooks/useService';
import type { DocumentDerivative, FileScan, RecordFile } from '../types';
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
  const rawTab = params.get('tab');
  const tab: 'queue' | 'custody' | 'studio' =
    rawTab === 'custody' ? 'custody' : rawTab === 'studio' ? 'studio' : 'queue';
  const [workbench, setWorkbench] = useState(false);

  const setTab = (next: 'queue' | 'custody' | 'studio') => {
    const search = new URLSearchParams(params);
    if (next === 'custody' || next === 'studio') search.set('tab', next);
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
              ...(allowed('studio.use') ? ([['studio', 'Edit in studio']] as const) : []),
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => {
                setTab(key);
                // The studio tab is the operator entry to the workbench: it
                // opens the "new digitization" picker, whose "Open studio"
                // leads into the scan studio (scan pages, reorder, build PDF).
                if (key === 'studio') setWorkbench(true);
              }}
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

      {tab === 'queue' ? <ScanReviewQueue /> : tab === 'custody' ? <CustodyRegister /> : null}

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
                Edit in studio
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
  const navigate = useNavigate();
  const { allowed } = useSession();

  const [search, setSearch] = useState('');
  const [subQueue, setSubQueue] = useState<'deliverables' | 'pages'>('deliverables');
  const [busyId, setBusyId] = useState('');
  const [rejectingScan, setRejectingScan] = useState<FileScan | null>(null);
  const [previewingScan, setPreviewingScan] = useState<FileScan | null>(null);
  const [rejectingPdf, setRejectingPdf] = useState<DocumentDerivative | null>(null);
  const [previewingPdf, setPreviewingPdf] = useState<DocumentDerivative | null>(null);
  const { success, danger } = useFlash();

  const {
    data: queue,
    loading: loadingPages,
    reload: reloadPages,
  } = useQuery(() => service.digitization.pending({ search }), [search], [] as FileScan[], [
    'digitization',
  ]);

  const {
    data: pendingPdfs,
    loading: loadingPdfs,
    reload: reloadPdfs,
  } = useQuery(
    () => service.digitization.pendingPdfs({ search }),
    [search],
    [] as DocumentDerivative[],
    ['digitization'],
  );

  const reloadAll = () => {
    reloadPages();
    reloadPdfs();
  };

  const reviewScan = async (scan: FileScan, decision: 'Approved' | 'Rejected', note = '') => {
    setBusyId(scan.id);
    try {
      const result = await service.digitization.review(scan.id, decision, note);
      if (!result.ok) {
        danger(result.error);
        return;
      }
      success(`${scan.filename} ${decision.toLowerCase()}.`);
      reloadAll();
    } finally {
      setBusyId('');
    }
  };

  const reviewPdf = async (
    pdf: DocumentDerivative,
    decision: 'Approved' | 'Rejected',
    note = '',
  ) => {
    setBusyId(pdf.id);
    try {
      const result = await service.digitization.reviewPdf(pdf.id, decision, note, pdf.fileId);
      if (!result.ok) {
        danger(result.error);
        return;
      }
      success(`${pdf.filename} ${decision.toLowerCase()}.`);
      reloadAll();
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Metric
          icon={<FilePdf />}
          label="Generated Documents"
          value={String(pendingPdfs.length)}
          tone={pendingPdfs.length > 0 ? 'warning' : 'neutral'}
          hint="Compiled deliverable PDFs awaiting approval"
        />
        <Metric
          icon={<Scan />}
          label="Scan Pages"
          value={String(queue.length)}
          hint="Individual pages awaiting review"
        />
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
            placeholder="File barcode, file number or document name…"
            aria-label="Search the review queue"
          />
        </div>

        {/* Sub-Queue Selector: Generated Documents vs Scan Pages */}
        <div className="flex flex-wrap items-center gap-2 border-b border-base bg-[var(--rr-surface)] px-4 py-2.5">
          <button
            type="button"
            onClick={() => setSubQueue('deliverables')}
            className={`focus-ring inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              subQueue === 'deliverables'
                ? 'bg-[var(--rr-accent-fill)] text-white'
                : 'muted hover:bg-[var(--rr-surface-2)] hover:text-[var(--rr-text)]'
            }`}
          >
            <FilePdf size={15} />
            Generated Documents
            {pendingPdfs.length > 0 && (
              <span
                className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  subQueue === 'deliverables'
                    ? 'bg-white text-[var(--rr-accent-fill)]'
                    : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                }`}
              >
                {pendingPdfs.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setSubQueue('pages')}
            className={`focus-ring inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              subQueue === 'pages'
                ? 'bg-[var(--rr-accent-fill)] text-white'
                : 'muted hover:bg-[var(--rr-surface-2)] hover:text-[var(--rr-text)]'
            }`}
          >
            <Scan size={15} />
            Scan Pages
            {queue.length > 0 && (
              <span
                className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  subQueue === 'pages'
                    ? 'bg-white text-[var(--rr-accent-fill)]'
                    : 'bg-[var(--rr-surface-2)]'
                }`}
              >
                {queue.length}
              </span>
            )}
          </button>
        </div>

        {/* TAB A: Deliverable PDF Documents */}
        {subQueue === 'deliverables' && (
          <>
            {loadingPdfs && pendingPdfs.length === 0 ? (
              <RowSkeleton rows={4} />
            ) : pendingPdfs.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No generated documents awaiting review"
                  description="When a deliverable PDF is built in the studio, it appears here for supervisor sign-off."
                  action={
                    <button
                      type="button"
                      onClick={() => setSubQueue('pages')}
                      className="focus-ring text-xs font-semibold text-accent underline"
                    >
                      View scan pages queue ({queue.length})
                    </button>
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-[var(--rr-border)]">
                {pendingPdfs.map((pdf) => (
                  <li key={pdf.id} className="p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <FilePdf size={18} className="text-accent" />
                          <p className="break-all font-semibold">{pdf.filename}</p>
                          <Badge tone="warning">Pending approval</Badge>
                        </div>
                        <p className="muted mt-1 text-[11px]">
                          File{' '}
                          <Link
                            to={`/files/${pdf.fileId}`}
                            className="focus-ring font-mono font-semibold text-accent"
                          >
                            {pdf.fileNumber || pdf.fileBarcode}
                          </Link>{' '}
                          · {pdf.pageCount} page(s)
                          {pdf.sizeBytes
                            ? ` · ${Math.max(1, Math.round(pdf.sizeBytes / 1024))} KB`
                            : ''}{' '}
                          · Built {new Date(pdf.createdAt).toLocaleString()} by {pdf.createdBy}
                        </p>
                        {pdf.reviewNote && (
                          <p className="mt-1.5 rounded-md bg-[var(--rr-bg)] p-2 text-[11px] text-[var(--rr-warning)]">
                            Remarks: {pdf.reviewNote}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Button
                          variant="ghost"
                          icon={<Eye size={16} />}
                          onClick={() => setPreviewingPdf(pdf)}
                        >
                          Preview
                        </Button>
                        <Button
                          variant="secondary"
                          icon={<PencilSimple size={15} />}
                          onClick={() => navigate(`/files/${pdf.fileId}/studio`)}
                          title="Open studio composition for this file"
                        >
                          Edit in studio
                        </Button>
                        {allowed('digitization.review') && (
                          <>
                            <Button
                              icon={<CheckCircle size={16} />}
                              disabled={busyId === pdf.id}
                              onClick={() => void reviewPdf(pdf, 'Approved')}
                            >
                              Approve
                            </Button>
                            <Button
                              variant="ghost"
                              icon={<XCircle size={16} />}
                              disabled={busyId === pdf.id}
                              onClick={() => setRejectingPdf(pdf)}
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
          </>
        )}

        {/* TAB B: Individual Scan Pages */}
        {subQueue === 'pages' && (
          <>
            {loadingPages && queue.length === 0 ? (
              <RowSkeleton rows={6} />
            ) : queue.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No scan pages awaiting review"
                  description="Add page scans from a file page or the studio; they appear here for review."
                  action={
                    <button
                      type="button"
                      onClick={() => setSubQueue('deliverables')}
                      className="focus-ring text-xs font-semibold text-accent underline"
                    >
                      View generated documents ({pendingPdfs.length})
                    </button>
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
                          onClick={() => setPreviewingScan(scan)}
                        >
                          Preview
                        </Button>
                        {allowed('digitization.review') && (
                          <>
                            <Button
                              icon={<CheckCircle size={16} />}
                              disabled={busyId === scan.id}
                              onClick={() => void reviewScan(scan, 'Approved')}
                            >
                              Approve
                            </Button>
                            <Button
                              variant="ghost"
                              icon={<XCircle size={16} />}
                              disabled={busyId === scan.id}
                              onClick={() => setRejectingScan(scan)}
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
          </>
        )}
      </Card>

      {/* Preview Page Modal */}
      <Modal
        open={previewingScan !== null}
        onClose={() => setPreviewingScan(null)}
        title={`Scan preview — ${previewingScan?.filename ?? ''}`}
        description={
          previewingScan
            ? `Page ${previewingScan.pageNo} · v${previewingScan.version} of ${previewingScan.fileBarcode}`
            : undefined
        }
      >
        {previewingScan && (
          <DocumentViewer
            docKey={previewingScan.id}
            load={() => service.digitization.scanBlob(previewingScan.id)}
            filename={previewingScan.filename}
            contentType={previewingScan.contentType}
            pageIndex={previewingScan.pageIndex}
            fill
          />
        )}
      </Modal>

      {/* Preview Deliverable PDF Modal */}
      <Modal
        open={previewingPdf !== null}
        onClose={() => setPreviewingPdf(null)}
        title={`Deliverable preview — ${previewingPdf?.filename ?? ''}`}
        description={
          previewingPdf
            ? `Built from ${previewingPdf.pageCount} page(s) · Status: ${previewingPdf.status}`
            : undefined
        }
      >
        {previewingPdf && (
          <DocumentViewer
            docKey={previewingPdf.id}
            load={() => service.digitization.pdfBlob(previewingPdf.id, previewingPdf.fileId)}
            filename={previewingPdf.filename}
            contentType="application/pdf"
            fill
          />
        )}
      </Modal>

      {/* Reject Page Modal */}
      <Modal
        open={rejectingScan !== null}
        onClose={() => setRejectingScan(null)}
        title={`Reject ${rejectingScan?.filename ?? ''}`}
      >
        {rejectingScan && (
          <RejectForm
            title="Reject page"
            onSubmit={async (note) => {
              await reviewScan(rejectingScan, 'Rejected', note);
              setRejectingScan(null);
            }}
          />
        )}
      </Modal>

      {/* Reject Deliverable PDF Modal */}
      <Modal
        open={rejectingPdf !== null}
        onClose={() => setRejectingPdf(null)}
        title={`Reject deliverable — ${rejectingPdf?.filename ?? ''}`}
        description="The build stays in history with your rejection reason; the operator can fix composition in studio and rebuild."
      >
        {rejectingPdf && (
          <RejectForm
            title="Reject deliverable PDF"
            placeholder="Wrong page order, missing signature on page 3…"
            onSubmit={async (note) => {
              await reviewPdf(rejectingPdf, 'Rejected', note);
              setRejectingPdf(null);
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

function RejectForm({
  onSubmit,
  title = 'Reject',
  placeholder = 'Skew beyond tolerance, missing half the page…',
}: {
  onSubmit: (note: string) => void;
  title?: string;
  placeholder?: string;
}) {
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
          placeholder={placeholder}
        />
      </Field>
      <Button type="submit" disabled={!note.trim()}>
        {title}
      </Button>
    </form>
  );
}
