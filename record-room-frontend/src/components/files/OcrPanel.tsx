import { useEffect, useMemo, useState } from 'react';
import {
  ArrowClockwise,
  CaretDown,
  Check,
  Copy,
  FilePdf,
  MagnifyingGlass,
  PencilSimple,
  TextAa,
  X,
} from '@phosphor-icons/react';
import { pdfjs, Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { useFlash, useQuery, useService, useSession } from '../../hooks/useService';
import { cn } from '../../lib/utils';
import { formatDocumentSize, describePageCount } from '../../lib/document';
import type {
  DocumentDerivative,
  DocumentVersionPage,
  RecordFileDocument,
} from '../../types';
import type { OcrStatusInfo } from '../../services/contracts';

/**
 * The OCR tab, reworked per the operator's workflow: the document preview sits
 * on the LEFT, the OCR text of the selected page on the RIGHT, and the page
 * navigation — prev / next arrows plus a direct page picker — runs along the
 * TOP. Keyboard ← / → move between pages here too.
 *
 * The OCR text is the persisted per-page store of the selected document
 * version, so what you read is always the text of exactly the version you are
 * previewing (never the studio's working pages). Re-run and hand-correction
 * stay available per page.
 */

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const PDF_OPTIONS = {
  cMapUrl: '/cmaps/',
  standardFontDataUrl: '/standard_fonts/',
  wasmUrl: '/wasm/',
  verbosity: 0,
} as const;

/** ← / → move between pages when nothing editable has focus. */
function usePageKeys(active: boolean, onPrev: () => void, onNext: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      )
        return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onPrev();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, onPrev, onNext]);
}

interface VersionOption {
  id: string;
  source: 'document' | 'derivative';
  filename: string;
  versionLabel: string;
  pageCount?: number;
  sizeBytes?: number;
}

export function OcrPanel({ fileId }: { fileId: string }) {
  const service = useService();
  const { allowed } = useSession();
  const { success, danger } = useFlash();
  const canEditOcr = allowed('digitization.upload');

  const [search, setSearch] = useState('');
  const [busyPage, setBusyPage] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [ocrStatus, setOcrStatus] = useState<OcrStatusInfo | null>(null);

  // Which stored version's pages are being read; defaults to the newest.
  const [versionId, setVersionId] = useState<string | null>(null);
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [url, setUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [loadError, setLoadError] = useState(false);

  const { data: docs } = useQuery(
    () => service.files.listDocuments(fileId),
    [fileId],
    [] as RecordFileDocument[],
    ['files'],
  );
  const { data: derivatives } = useQuery(
    () => service.digitization.listPdfs(fileId),
    [fileId],
    [] as DocumentDerivative[],
    ['digitization'],
  );

  const versions: VersionOption[] = useMemo(
    () =>
      [
        ...docs.map((doc) => ({
          id: doc.id,
          source: 'document' as const,
          filename: doc.filename,
          versionLabel: `v${doc.version}`,
          pageCount: doc.pageCount,
          sizeBytes: doc.sizeBytes,
        })),
        ...derivatives.map((deriv) => ({
          id: deriv.id,
          source: 'derivative' as const,
          filename: deriv.filename,
          versionLabel: 'Built PDF',
          pageCount: deriv.pageCount,
          sizeBytes: deriv.sizeBytes,
        })),
      ].sort((a, b) => a.filename.localeCompare(b.filename)),
    [docs, derivatives],
  );

  const selectedVersion =
    versions.find((version) => version.id === versionId) ?? versions[0] ?? null;

  // Per-page OCR rows of the selected version, from the persisted store.
  const [pages, setPages] = useState<DocumentVersionPage[] | null>(null);

  // Switching versions resets the per-version reader state (page, edit draft,
  // stale blob and rows) before the load effect below fetches the new ones.
  // Render-phase adjustment, the pattern PageOcrViewer's caller avoids by
  // remounting; here the state lives in this component.
  const [prevVersionKey, setPrevVersionKey] = useState(fileId + selectedVersion?.id);
  if (prevVersionKey !== fileId + selectedVersion?.id) {
    setPrevVersionKey(fileId + selectedVersion?.id);
    setCurrentPage(1);
    setNumPages(0);
    setLoadError(false);
    setEditing(false);
    setPages(null);
    setUrl(null);
  }

  useEffect(() => {
    void service.config
      .info()
      .then((info) => setOcrStatus(info.ocr))
      .catch(() => setOcrStatus(null));
  }, [service]);

  // Load the preview blob + the stored page rows of the selected version. The
  // render-phase reset above has already cleared the previous version's state.
  useEffect(() => {
    if (!selectedVersion) return;
    let live = true;
    let created: string | null = null;

    const load = async () => {
      try {
        const blob =
          selectedVersion.source === 'document'
            ? await service.files.documentBlob(fileId, selectedVersion.id)
            : await service.digitization.pdfBlob(selectedVersion.id, fileId);
        if (!live) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      } catch {
        if (live) setLoadError(true);
      }
      try {
        if (selectedVersion.source === 'document') {
          const rows = await service.files.documentPages(fileId, selectedVersion.id);
          if (live) setPages(rows);
        } else {
          if (live) setPages([]);
        }
      } catch {
        if (live) setPages([]);
      }
    };
    void load();
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, selectedVersion?.id]);

  // While the background pass is still filling pages, poll the coverage
  // status and re-read the page rows each time it advances — the panel goes
  // from "0/8 pages with text" to the full count without a manual reload.
  // Polling stops as soon as the API reports processing=false, or when the
  // selected version changes / the component unmounts.
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [statusTick, setStatusTick] = useState(0);
  useEffect(() => {
    if (!selectedVersion || selectedVersion.source !== 'document') return;
    let live = true;
    // The first status answer replaces the previous version's flag; a fresh
    // version starts as "not processing" until its own status says otherwise.
    window.setTimeout(() => {
      if (live) setOcrProcessing(false);
    }, 0);
    const poll = async () => {
      const status = await service.files
        .documentOcrStatus(fileId, selectedVersion.id)
        .catch(() => null);
      if (!live || !status) return;
      setOcrProcessing(status.processing);
      if (status.processing) {
        // Refresh the rows so the coverage badge climbs as pages land.
        try {
          setPages(await service.files.documentPages(fileId, selectedVersion.id));
        } catch {
          /* the next tick retries */
        }
        window.setTimeout(() => {
          if (live) setStatusTick((tick) => tick + 1);
        }, 3000);
      }
    };
    void poll();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, selectedVersion?.id, statusTick]);

  const totalPages = Math.max(
    numPages,
    pages?.length ? Math.max(...pages.map((p) => p.pageNo)) : 0,
    selectedVersion?.pageCount ?? 0,
  );

  const selected = pages?.find((page) => page.pageNo === currentPage) ?? null;
  const withText = pages?.filter((page) => page.ocrText.trim()).length ?? 0;

  const visiblePages = useMemo(
    () =>
      (pages ?? []).filter((page) => {
        if (!search.trim()) return true;
        const needle = search.toLowerCase();
        return (
          `page ${page.pageNo}`.includes(needle) ||
          page.ocrText.toLowerCase().includes(needle) ||
          (selectedVersion?.filename.toLowerCase().includes(needle) ?? false)
        );
      }),
    [pages, search, selectedVersion],
  );

  const goPrev = () => setCurrentPage((page) => Math.max(1, page - 1));
  const goNext = () =>
    setCurrentPage((page) => Math.min(totalPages > 0 ? totalPages : 1, page + 1));
  usePageKeys(Boolean(selectedVersion), goPrev, goNext);

  const regenerate = async (pageNo: number) => {
    if (!selectedVersion || selectedVersion.source !== 'document') return;
    setBusyPage(pageNo);
    try {
      const result = await service.files.runDocumentPageOcr(fileId, selectedVersion.id, pageNo);
      if (!result.ok) {
        danger(result.error);
        return;
      }
      setPages((rows) => (rows ?? []).map((row) => (row.pageNo === pageNo ? result.value : row)));
      success(
        result.value.ocrText.trim()
          ? `OCR re-run for page ${pageNo} (${result.value.ocrMethod}).`
          : `OCR ran for page ${pageNo} but found no text — a very dark or blurry scan can come back empty.`,
      );
    } finally {
      setBusyPage(0);
    }
  };

  const save = async (pageNo: number) => {
    if (!selectedVersion || selectedVersion.source !== 'document') return;
    setBusyPage(pageNo);
    try {
      const result = await service.files.saveDocumentPageOcr(
        fileId,
        selectedVersion.id,
        pageNo,
        draft,
      );
      if (!result.ok) {
        danger(result.error);
        return;
      }
      success(`OCR text saved for page ${pageNo}.`);
      setEditing(false);
      setPages((rows) => (rows ?? []).map((row) => (row.pageNo === pageNo ? result.value : row)));
    } finally {
      setBusyPage(0);
    }
  };

  const copyPage = async (page: DocumentVersionPage) => {
    try {
      await navigator.clipboard.writeText(page.ocrText);
      success(`Page ${page.pageNo} text copied.`);
    } catch {
      danger('The browser blocked clipboard access.');
    }
  };

  const copyAll = async () => {
    const text = (pages ?? [])
      .map((page) => `--- Page ${page.pageNo} ---\n${page.ocrText}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      success('OCR text of all pages copied.');
    } catch {
      danger('The browser blocked clipboard access.');
    }
  };

  if (versions.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No document versions yet"
          description="Upload a PDF for this file — the background pass extracts every page's text automatically once it is stored."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status strip: engine + coverage + search + copy. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={withText === totalPages && totalPages > 0 ? 'success' : 'warning'}>
            {withText}/{totalPages || '…'} pages with text
          </Badge>
          {ocrProcessing && (
            <span className="muted animate-pulse" role="status">
              OCR running in the background…
            </span>
          )}
          {ocrStatus && !ocrStatus.available && <Badge tone="danger">OCR engine unavailable</Badge>}
          <span className="muted">
            {ocrStatus
              ? ocrStatus.available
                ? `${ocrStatus.engine} · ${ocrStatus.languages}`
                : ocrStatus.note
              : 'OCR status unknown.'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-56">
            <div className="relative">
              <MagnifyingGlass
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--rr-muted)]"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search page text…"
                aria-label="Search OCR text"
                className="focus-ring h-9 w-full rounded-lg border border-base bg-[var(--rr-surface)] pl-9 text-xs outline-none"
              />
            </div>
          </div>
          {withText > 0 && (
            <Button size="sm" variant="ghost" icon={<Copy size={14} />} onClick={() => void copyAll()}>
              Copy all
            </Button>
          )}
        </div>
      </div>

      {/* Version picker + page navigation, along the top. */}
      <div className="flex flex-col gap-3 rounded-xl border border-base bg-[var(--rr-surface)] p-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Document version dropdown */}
        <div className="relative min-w-0">
          <button
            type="button"
            onClick={() => setVersionMenuOpen((open) => !open)}
            className="focus-ring flex w-full min-w-56 items-center gap-2 rounded-lg border border-base bg-[var(--rr-bg)] px-3 py-2 text-left text-xs font-semibold hover:bg-[var(--rr-surface-2)] sm:w-72"
            aria-haspopup="listbox"
            aria-expanded={versionMenuOpen}
          >
            <FilePdf size={15} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate">
              {selectedVersion?.filename}
              <span className="muted ml-1.5 font-normal">
                {selectedVersion?.versionLabel}
                {selectedVersion?.pageCount ? ` · ${describePageCount(selectedVersion.pageCount)}` : ''}
                {selectedVersion?.sizeBytes
                  ? ` · ${formatDocumentSize(selectedVersion.sizeBytes)}`
                  : ''}
              </span>
            </span>
            <CaretDown size={13} className="shrink-0 text-[var(--rr-muted)]" />
          </button>
          {versionMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setVersionMenuOpen(false)}
                aria-hidden
              />
              <ul
                role="listbox"
                className="absolute left-0 top-full z-20 mt-1 max-h-72 w-full min-w-72 overflow-y-auto rounded-xl border border-base bg-[var(--rr-surface)] p-1.5 shadow-xl"
              >
                {versions.map((version) => (
                  <li key={version.id} role="option" aria-selected={version.id === selectedVersion?.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setVersionId(version.id);
                        setVersionMenuOpen(false);
                        setSearch('');
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition',
                        version.id === selectedVersion?.id
                          ? 'bg-accent-soft/50 text-accent'
                          : 'hover:bg-[var(--rr-surface-2)]',
                      )}
                    >
                      <FilePdf size={14} className="shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{version.filename}</span>
                        <span className="muted block text-[11px]">
                          {version.source === 'document' ? 'Scan PDF' : 'Built PDF'} ·{' '}
                          {version.versionLabel}
                          {version.pageCount ? ` · ${version.pageCount} page(s)` : ''}
                        </span>
                      </span>
                      {version.id === selectedVersion?.id && <Check size={14} className="shrink-0" />}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Page navigation with arrows */}
        <div className="flex items-center gap-2">
          <div className="flex items-center overflow-hidden rounded-lg border border-base">
            <button
              type="button"
              onClick={goPrev}
              disabled={currentPage <= 1}
              className="focus-ring grid size-9 place-items-center hover:bg-[var(--rr-surface-2)] disabled:opacity-40"
              aria-label="Previous page"
              title="Previous page (←)"
            >
              <span className="text-sm font-semibold">‹</span>
            </button>
            <input
              value={currentPage}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10);
                if (Number.isFinite(value) && value >= 1 && value <= totalPages)
                  setCurrentPage(value);
              }}
              inputMode="numeric"
              aria-label="Go to page"
              className="w-12 border-x border-base bg-transparent py-1.5 text-center text-xs font-semibold outline-none"
            />
            <button
              type="button"
              onClick={goNext}
              disabled={totalPages === 0 || currentPage >= totalPages}
              className="focus-ring grid size-9 place-items-center hover:bg-[var(--rr-surface-2)] disabled:opacity-40"
              aria-label="Next page"
              title="Next page (→)"
            >
              <span className="text-sm font-semibold">›</span>
            </button>
          </div>
          <span className="muted text-xs font-semibold">of {totalPages || '…'}</span>
        </div>
      </div>

      {/* Master–detail: preview left, OCR text right. Keyed by the selected
          version so switching resets the page, the loaded blob and the edit
          state in one remount instead of effect bookkeeping. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Preview */}
        <div className="overflow-hidden rounded-xl border border-base bg-[var(--rr-surface)]">
          {loadError ? (
            <div className="grid h-[420px] place-items-center p-6 text-center">
              <div>
                <p className="text-sm font-semibold">The preview could not be loaded.</p>
                <p className="muted mt-1 text-xs">
                  The stored bytes of this version are unavailable right now.
                </p>
              </div>
            </div>
          ) : !url ? (
            <div className="grid h-[420px] place-items-center rounded-xl bg-[var(--rr-surface-2)] text-xs muted">
              Loading preview…
            </div>
          ) : (
            <div className="flex max-h-[calc(100dvh-22rem)] justify-center overflow-auto bg-[var(--rr-surface-2)] p-4">
              <Document
                file={url}
                options={PDF_OPTIONS}
                onLoadSuccess={(pdf) => setNumPages(pdf.numPages)}
                onLoadError={() => setLoadError(true)}
                loading={
                  <div className="grid h-72 place-items-center text-xs muted">Loading preview…</div>
                }
                error={
                  <div className="grid h-72 place-items-center p-6 text-center text-xs muted">
                    This PDF could not be rendered.
                  </div>
                }
              >
                <Page
                  key={`${selectedVersion?.id}-${currentPage}`}
                  pageNumber={Math.min(Math.max(1, currentPage), Math.max(1, totalPages))}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  className="mx-auto shadow-sm"
                  loading={
                    <div className="h-[600px] w-[440px] animate-pulse rounded bg-[var(--rr-bg)]" />
                  }
                />
              </Document>
            </div>
          )}
        </div>

        {/* OCR text of the selected page */}
        <div className="overflow-hidden rounded-xl border border-base bg-[var(--rr-surface)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Page {currentPage}</span>
              {selected?.ocrMethod ? <Badge tone="neutral">{selected.ocrMethod}</Badge> : null}
              {selected?.ocrEditedBy && selected.ocrEditedAt ? (
                <Badge tone="info">edited by hand</Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selected?.ocrText?.trim() && !editing && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Copy size={14} />}
                  onClick={() => void copyPage(selected)}
                >
                  Copy
                </Button>
              )}
              {canEditOcr && selectedVersion?.source === 'document' && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<ArrowClockwise size={14} />}
                    disabled={busyPage === currentPage}
                    onClick={() => void regenerate(currentPage)}
                  >
                    {selected?.ocrText?.trim() ? 'Re-run OCR' : 'Run OCR'}
                  </Button>
                  {editing ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<X size={14} />}
                      onClick={() => setEditing(false)}
                    >
                      Cancel
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<PencilSimple size={14} />}
                      onClick={() => {
                        setEditing(true);
                        setDraft(selected?.ocrText ?? '');
                      }}
                    >
                      Edit text
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="p-4">
            {editing ? (
              <div className="space-y-3">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={16}
                  aria-label={`OCR text of page ${currentPage}`}
                  className="focus-ring w-full rounded-lg border border-base bg-[var(--rr-bg)] p-3 font-mono text-[13px] leading-6 outline-none"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    icon={<Check size={15} />}
                    disabled={busyPage === currentPage}
                    onClick={() => void save(currentPage)}
                  >
                    Save correction
                  </Button>
                </div>
              </div>
            ) : selected?.ocrText?.trim() ? (
              <p className="max-h-[calc(100dvh-26rem)] overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--rr-bg)] p-4 font-mono text-[13px] leading-6">
                {selected.ocrText}
              </p>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <TextAa size={28} className="text-[var(--rr-muted)]" />
                <p className="muted text-sm">
                  {selectedVersion?.source === 'derivative'
                    ? 'Built PDFs carry their text inside the file — the preview search reaches it.'
                    : 'No OCR text on this page yet — the background pass may still be running, or run recognition now.'}
                </p>
                {canEditOcr && selectedVersion?.source === 'document' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<ArrowClockwise size={14} />}
                    disabled={busyPage === currentPage}
                    onClick={() => void regenerate(currentPage)}
                  >
                    Run OCR on this page
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search results across pages, below the split. */}
      {search.trim() && (pages?.length ?? 0) > 0 && (
        <Card padding={false} className="overflow-hidden">
          <p className="border-b border-base px-4 py-3 text-xs font-semibold">
            {visiblePages.length} page(s) match “{search.trim()}”
          </p>
          {visiblePages.length === 0 ? (
            <p className="muted p-5 text-xs">No page matches this text search.</p>
          ) : (
            <ul className="max-h-64 divide-y divide-[var(--rr-border)] overflow-y-auto">
              {visiblePages.map((page) => (
                <li key={page.id || page.pageNo}>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(page.pageNo)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--rr-surface-2)]"
                  >
                    <span className="text-xs font-semibold">Page {page.pageNo}</span>
                    <span className="muted min-w-0 flex-1 truncate text-[11px]">
                      {page.ocrText.trim().slice(0, 80) || 'No text'}
                    </span>
                    {page.ocrText.trim() ? (
                      <Badge tone="success">text</Badge>
                    ) : (
                      <Badge tone="neutral">none</Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
