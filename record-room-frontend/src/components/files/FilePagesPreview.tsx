import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  FilePdf,
  Scan,
  X,
  XCircle,
} from '@phosphor-icons/react';
import { pdfjs } from 'react-pdf';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/Flash';
import { DocumentViewer } from './DocumentViewer';
import { useFlash, useQuery, useService } from '../../hooks/useService';
import { changeKindOf } from '../../lib/reviewGroup';
import type { DocumentDerivative, FileScan } from '../../types';
import { cn } from '../../lib/utils';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/**
 * Renders exactly one page of a stored PDF as a thumbnail URL, so previewing a
 * 100-page scan does not rasterize the other 99. Images are served as-is.
 */
async function pageThumbOf(scan: FileScan, load: () => Promise<Blob>): Promise<string> {
  const blob = await load();
  const isPdf = blob.type === 'application/pdf' || scan.filename.toLowerCase().endsWith('.pdf');
  if (!isPdf) return URL.createObjectURL(blob);
  const data = await blob.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pageNo = Math.min(Math.max(1, scan.pageIndex ?? 1), pdf.numPages);
  const page = await pdf.getPage(pageNo);
  const viewport = page.getViewport({ scale: 0.55 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no canvas');
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  const thumb = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.7);
  });
  if (!thumb) throw new Error('no thumbnail');
  return URL.createObjectURL(thumb);
}

/**
 * The full-file review surface (round 5, reworked): every page of the file in
 * composition order, the changed ones highlighted and selectable, so the
 * reviewer sees the whole document and exactly what is new — then approves or
 * rejects the selection with one remark. Pending deliverable builds sit above
 * the grid.
 *
 * Rendered as its own page (route /review/:fileId), no longer inside a modal:
 * a 40-page grid deserves the whole viewport, a stable URL and the browser's
 * own back button. The one-page zoom stays an overlay — it is a viewer, not a
 * decision surface — and swallows Escape itself so closing it never loses the
 * selection or the remark.
 */
export function FilePagesPreview({
  fileId,
  fileLabel,
  subject,
  canReview,
  pendingPdfs,
  onReviewed,
}: {
  fileId: string;
  fileLabel: string;
  subject: string;
  canReview: boolean;
  pendingPdfs: DocumentDerivative[];
  onReviewed: () => void;
}) {
  const service = useService();
  const { success, danger } = useFlash();
  const {
    data: pages,
    loading,
    reload,
  } = useQuery(() => service.digitization.list(fileId), [fileId], [] as FileScan[], [
    'digitization',
  ]);

  const [mode, setMode] = useState<'all' | 'changed'>('all');
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [zoomed, setZoomed] = useState<FileScan | null>(null);
  const [pdfPreviewId, setPdfPreviewId] = useState<string | null>(null);
  const [rejectingPdf, setRejectingPdf] = useState<DocumentDerivative | null>(null);

  const pendingPages = useMemo(
    () => pages.filter((page) => page.status === 'Pending review'),
    [pages],
  );

  // The default selection is every change, and it resets on its own whenever
  // the pending set changes (a decision, a reload): the state is keyed by the
  // pending ids instead of synced through an effect.
  const pendingKey = pendingPages
    .map((page) => page.id)
    .sort()
    .join(',');
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> }>({
    key: '',
    ids: new Set<string>(),
  });
  const selected =
    selection.key === pendingKey ? selection.ids : new Set(pendingPages.map((page) => page.id));

  // Thumbnails load a few at a time (a burst of 80 parallel rasterizations
  // froze the tab on large files); URLs are revoked when the preview unmounts.
  useEffect(() => {
    const created: string[] = [];
    let live = true;
    const queue = pages.filter((page) => page.hasDocument).slice(0, 240);
    let cursor = 0;
    const worker = async () => {
      while (live && cursor < queue.length) {
        const page = queue[cursor++];
        try {
          const url = await pageThumbOf(page, () =>
            service.digitization.scanBlob(page.id, page.hasProcessed ? 'processed' : 'original'),
          );
          if (!live) {
            URL.revokeObjectURL(url);
            return;
          }
          created.push(url);
          setThumbs((current) => ({ ...current, [page.id]: url }));
        } catch {
          /* the card keeps its placeholder */
        }
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => {
      live = false;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [pages, service]);

  // The zoom overlay is the only thing Escape should close here.
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setZoomed(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [zoomed]);

  const visible = mode === 'changed' ? pendingPages : pages;

  const toggle = (scanId: string) => {
    const next = new Set(selected);
    if (next.has(scanId)) next.delete(scanId);
    else next.add(scanId);
    setSelection({ key: pendingKey, ids: next });
  };

  const decide = async (decision: 'Approved' | 'Rejected') => {
    if (selected.size === 0) return;
    if (decision === 'Rejected' && !remark.trim()) return;
    setBusy(true);
    try {
      // One batch call — the fileId lets the adapter hit the review-set endpoint.
      const result = await service.digitization.reviewScans(
        [...selected],
        decision,
        remark,
        fileId,
      );
      if (!result.ok) {
        danger(result.error);
        return;
      }
      success(
        `${result.value} page(s) ${decision.toLowerCase()}${remark.trim() ? ' — remark saved' : ''}.`,
      );
      setRemark('');
      reload();
      onReviewed();
    } finally {
      setBusy(false);
    }
  };

  const reviewPdf = useCallback(
    async (pdf: DocumentDerivative, decision: 'Approved' | 'Rejected', note = '') => {
      setBusy(true);
      try {
        const result = await service.digitization.reviewPdf(pdf.id, decision, note, pdf.fileId);
        if (!result.ok) {
          danger(result.error);
          return;
        }
        success(`${pdf.filename} ${decision.toLowerCase()}.`);
        onReviewed();
      } finally {
        setBusy(false);
      }
    },
    [onReviewed, danger, success, service],
  );

  return (
    <div className="space-y-5">
      {/* Pending deliverable builds of this file. */}
      {pendingPdfs.length > 0 && (
        <section className="space-y-3">
          <p className="text-sm font-semibold">
            Deliverable builds <span className="muted font-normal">({pendingPdfs.length})</span>
          </p>
          {pendingPdfs.map((pdf) => (
            <div key={pdf.id} className="rounded-xl border border-base p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    <FilePdf size={17} className="text-accent" />
                    {pdf.filename}
                    <Badge tone="warning">Pending approval</Badge>
                  </p>
                  <p className="muted mt-1 text-xs">
                    {pdf.pageCount} page(s)
                    {pdf.sizeBytes
                      ? ` · ${Math.max(1, Math.round(pdf.sizeBytes / 1024))} KB`
                      : ''}{' '}
                    · built {new Date(pdf.createdAt).toLocaleString()} by {pdf.createdBy}
                  </p>
                  {pdf.compressedFrom && (
                    <p className="muted mt-1 text-xs">
                      Compressed copy of {pdf.compressedFrom}
                      {pdf.savedPercent !== undefined ? ` · −${pdf.savedPercent}%` : ''}
                    </p>
                  )}
                  {pdf.reviewNote && (
                    <p className="mt-1.5 rounded-md bg-[var(--rr-bg)] p-2 text-xs text-[var(--rr-warning)]">
                      Remarks: {pdf.reviewNote}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setPdfPreviewId(pdfPreviewId === pdf.id ? null : pdf.id)}
                  >
                    {pdfPreviewId === pdf.id ? 'Hide preview' : 'Preview'}
                  </Button>
                  {canReview && (
                    <>
                      <Button
                        size="sm"
                        icon={<CheckCircle size={15} />}
                        disabled={busy}
                        onClick={() => void reviewPdf(pdf, 'Approved')}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<XCircle size={15} />}
                        disabled={busy}
                        onClick={() => setRejectingPdf(pdf)}
                      >
                        Reject…
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {pdfPreviewId === pdf.id && (
                <div className="mt-3 overflow-hidden rounded-lg border border-base">
                  <DocumentViewer
                    fill
                    docKey={pdf.id}
                    load={() => service.digitization.pdfBlob(pdf.id, pdf.fileId)}
                    filename={pdf.filename}
                    contentType="application/pdf"
                  />
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Page grid with the changed/unchanged toggle. */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-lg border border-base bg-[var(--rr-bg)] p-0.5">
            {(
              [
                ['all', `All pages (${pages.length})`],
                ['changed', `Changed (${pendingPages.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={cn(
                  'focus-ring min-h-8 rounded-md px-3 text-xs font-semibold transition',
                  mode === key
                    ? 'bg-[var(--rr-accent-fill)] text-white'
                    : 'muted hover:text-[var(--rr-text)]',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {canReview && pendingPages.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setSelection({ key: pendingKey, ids: new Set(pendingPages.map((page) => page.id)) })
              }
              className="focus-ring text-xs font-semibold text-accent underline"
            >
              Select all changed
            </button>
          )}
        </div>

        {loading && pages.length === 0 ? (
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((n) => (
              <div
                key={n}
                className="aspect-[3/4] animate-pulse rounded-xl bg-[var(--rr-surface-2)]"
              />
            ))}
          </div>
        ) : pages.length === 0 ? (
          <p className="muted py-6 text-center text-sm">
            This file has no scanned pages — only its build is waiting above.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map((page) => {
              const changed = page.status === 'Pending review';
              const kind = changed ? changeKindOf(page) : null;
              const isSelected = selected.has(page.id);
              return (
                <div
                  key={page.id}
                  className={cn(
                    'relative rounded-xl border p-2.5 transition',
                    changed
                      ? 'border-[color-mix(in_srgb,var(--rr-accent)_60%,transparent)] bg-accent-soft/30 ring-2 ring-[color-mix(in_srgb,var(--rr-accent)_35%,transparent)]'
                      : 'border-base bg-[var(--rr-bg)]',
                  )}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">Page {page.pageNo}</span>
                    {changed ? (
                      <Badge tone={kind === 'updated' ? 'warning' : 'info'}>
                        {kind === 'updated' ? 'Updated' : 'New'}
                      </Badge>
                    ) : (
                      <StatusBadge status={page.status} />
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setZoomed(page)}
                    className="focus-ring block grid aspect-[3/4] w-full place-items-center overflow-hidden rounded-lg bg-[var(--rr-surface-2)]"
                    aria-label={`Open page ${page.pageNo} preview`}
                  >
                    {thumbs[page.id] ? (
                      <img
                        src={thumbs[page.id]}
                        alt={`Page ${page.pageNo}`}
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-1 p-2 text-center">
                        <Scan size={22} className="text-accent" />
                        <span className="muted text-[10px] break-all">{page.filename}</span>
                      </div>
                    )}
                  </button>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="muted text-[11px]">
                      v{page.version}
                      {page.hasDocument ? '' : ' · no scan'}
                    </span>
                    {changed && canReview && (
                      <label className="flex min-h-8 cursor-pointer items-center gap-1.5 text-[11px] font-semibold">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(page.id)}
                          className="size-4 accent-[var(--rr-accent)]"
                        />
                        Select
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Decision bar with the shared remark — sticky at the viewport bottom
          now that the review surface owns a whole page. */}
      {canReview && pendingPages.length > 0 && (
        <div className="sticky bottom-4 z-30 space-y-3 rounded-xl border border-base bg-[var(--rr-surface)] p-4 shadow-lg shadow-black/5">
          <textarea
            value={remark}
            onChange={(event) => setRemark(event.target.value)}
            rows={2}
            placeholder="Remark (required to reject; kept with the version history)"
            className="focus-ring w-full rounded-lg border border-base bg-[var(--rr-bg)] p-3 text-sm outline-none"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="muted text-xs">
              {selected.size} of {pendingPages.length} changed page(s) selected
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                icon={<CheckCircle size={16} />}
                disabled={busy || selected.size === 0}
                onClick={() => void decide('Approved')}
              >
                Approve selected
              </Button>
              <Button
                variant="ghost"
                icon={<XCircle size={16} />}
                disabled={busy || selected.size === 0 || !remark.trim()}
                className="text-[var(--rr-danger)]"
                onClick={() => void decide('Rejected')}
              >
                Reject selected
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* One-page zoom overlay. */}
      {zoomed && (
        <div
          className="animate-fade fixed inset-0 z-[70] flex flex-col bg-slate-950/80 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => event.target === event.currentTarget && setZoomed(null)}
        >
          <div className="flex items-center justify-between gap-3 pb-3 text-white">
            <p className="text-sm font-semibold">
              {fileLabel} · Page {zoomed.pageNo} · v{zoomed.version}
            </p>
            <button
              type="button"
              onClick={() => setZoomed(null)}
              className="focus-ring grid size-10 place-items-center rounded-lg hover:bg-white/10"
              aria-label="Close page preview"
            >
              <X size={20} />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-stretch justify-center gap-2">
            <button
              type="button"
              onClick={() => setZoomed(prevPage(pages, zoomed))}
              disabled={prevPage(pages, zoomed) === null}
              className="focus-ring my-auto grid size-11 shrink-0 place-items-center rounded-full bg-white/10 text-white disabled:opacity-30"
              aria-label="Previous page"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="min-w-0 flex-1 overflow-hidden rounded-xl bg-white">
              <DocumentViewer
                fill
                docKey={zoomed.id}
                load={() =>
                  service.digitization.scanBlob(
                    zoomed.id,
                    zoomed.hasProcessed ? 'processed' : 'original',
                  )
                }
                filename={zoomed.filename}
                contentType={zoomed.contentType}
                pageIndex={zoomed.pageIndex}
              />
            </div>
            <button
              type="button"
              onClick={() => setZoomed(nextPage(pages, zoomed))}
              disabled={nextPage(pages, zoomed) === null}
              className="focus-ring my-auto grid size-11 shrink-0 place-items-center rounded-full bg-white/10 text-white disabled:opacity-30"
              aria-label="Next page"
            >
              <ArrowRight size={20} />
            </button>
          </div>
          <p className="muted pt-2 text-center text-xs text-white/70">{subject}</p>
        </div>
      )}

      {/* Reject-build remark form. */}
      {rejectingPdf && (
        <RejectBuildForm
          pdf={rejectingPdf}
          busy={busy}
          onCancel={() => setRejectingPdf(null)}
          onSubmit={(note) => {
            void reviewPdf(rejectingPdf, 'Rejected', note);
            setRejectingPdf(null);
          }}
        />
      )}
    </div>
  );
}

function RejectBuildForm({
  pdf,
  busy,
  onCancel,
  onSubmit,
}: {
  pdf: DocumentDerivative;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/60 p-4">
      <div className="surface w-full max-w-md rounded-2xl p-5">
        <h3 className="text-lg font-semibold">Reject {pdf.filename}</h3>
        <textarea
          autoFocus
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What is wrong with this build?"
          className="focus-ring mt-4 w-full rounded-lg border border-base bg-[var(--rr-bg)] p-3 text-sm outline-none"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => onSubmit(note.trim())}
            disabled={busy || !note.trim()}
          >
            Reject build
          </Button>
        </div>
      </div>
    </div>
  );
}

function prevPage(pages: FileScan[], current: FileScan): FileScan | null {
  const index = pages.findIndex((page) => page.id === current.id);
  return index > 0 ? pages[index - 1] : null;
}

function nextPage(pages: FileScan[], current: FileScan): FileScan | null {
  const index = pages.findIndex((page) => page.id === current.id);
  return index >= 0 && index < pages.length - 1 ? pages[index + 1] : null;
}
