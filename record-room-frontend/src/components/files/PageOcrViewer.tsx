import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Copy,
  DownloadSimple,
  MagnifyingGlass,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Spinner,
  TextAa,
  X,
} from '@phosphor-icons/react';
import { pdfjs, Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Badge } from '../ui/Badge';
import { useFlash, useService } from '../../hooks/useService';
import type { DocumentVersionPage } from '../../types';
import { cn } from '../../lib/utils';

/**
 * The document tab's reader. One clean column: the page in the middle, the OCR
 * text on demand on the right — never a page-number filmstrip on the left.
 *
 * OCR text comes from the per-page store (`documentPages`): the background
 * extraction pass persists it once, so opening the panel serves what is stored
 * instead of regenerating it. The explicit "Re-run" is the only thing that
 * recomputes a page.
 *
 * Keyboard: ← / → move between pages (and Esc closes the OCR panel), so a
 * hands-on-keyboard review never has to reach for the toolbar.
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

function isPdfFile(name: string, mime?: string): boolean {
  if (mime) {
    if (mime.includes('pdf')) return true;
    if (mime.startsWith('image/')) return false;
  }
  const ext = name.split('.').pop()?.toLowerCase();
  return ext !== 'png' && ext !== 'jpg' && ext !== 'jpeg' && ext !== 'gif' && ext !== 'webp';
}

/** Page navigation with ← / → when nothing editable has focus. */
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

export function PageOcrViewer({
  docKey,
  documentId,
  load,
  filename,
  meta,
  fileId,
  onOcrToggle,
  toolbarExtra,
}: {
  /** Changing it re-loads the blob and resets page, zoom, search and cache. */
  docKey: string;
  /** Stored document version id — the key the per-page OCR text is read by. */
  documentId?: string;
  load: () => Promise<Blob>;
  filename: string;
  meta?: ReactNode;
  fileId?: string;
  /** Notifies the page that the OCR side panel opened or closed. */
  onOcrToggle?: (open: boolean) => void;
  toolbarExtra?: ReactNode;
}) {
  const service = useService();
  const { success, danger } = useFlash();

  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [showOcr, setShowOcr] = useState(false);

  // Per-page OCR text, straight from the store — never regenerated on open.
  const [pages, setPages] = useState<DocumentVersionPage[] | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);

  const [query, setQuery] = useState('');
  const [matchPage, setMatchPage] = useState<number | null>(null);

  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const textCache = useRef(new Map<number, string>());

  // NOTE: the caller keys this component by `docKey`, so a different document
  // is a fresh mount — page, zoom, search and the text cache all start over
  // without any reset effect here.

  // The stored page rows: fetched once per document version, refreshed after a
  // re-run or a saved correction. Opening the panel never re-runs OCR.
  useEffect(() => {
    let live = true;
    const loadPages = async () => {
      if (!fileId || !documentId) return;
      try {
        const rows = await service.files.documentPages(fileId, documentId);
        if (live) setPages(rows);
      } catch {
        if (live) setPages([]);
      }
    };
    void loadPages();
    return () => {
      live = false;
    };
  }, [fileId, documentId, service]);

  useEffect(() => {
    onOcrToggle?.(showOcr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOcr]);

  // Blob lifecycle: one object URL per docKey, revoked on change/unmount.
  useEffect(() => {
    let live = true;
    let created: string | null = null;
    pdfRef.current = null;
    load()
      .then((blob) => {
        if (!live) return;
        const pdf = isPdfFile(filename, blob.type);
        created = URL.createObjectURL(
          blob.type ? blob : new Blob([blob], { type: pdf ? 'application/pdf' : 'image/jpeg' }),
        );
        setUrl(created);
        if (!pdf) {
          setNumPages(1);
        }
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, filename]);

  const totalPages = Math.max(
    numPages,
    pages?.length ? Math.max(...pages.map((p) => p.pageNo)) : 0,
  );

  const goPrev = () => setCurrentPage((page) => Math.max(1, page - 1));
  const goNext = () =>
    setCurrentPage((page) => Math.min(totalPages > 0 ? totalPages : 1, page + 1));
  usePageKeys(true, goPrev, goNext);

  const ocrPage = pages?.find((page) => page.pageNo === currentPage);
  const ocrTextOfCurrent = ocrPage?.ocrText?.trim() ?? '';

  const pdfTextOf = async (pageNo: number): Promise<string> => {
    const cached = textCache.current.get(pageNo);
    if (cached !== undefined) return cached;
    const pdf = pdfRef.current;
    if (!pdf || pageNo < 1 || pageNo > pdf.numPages) return '';
    try {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? (item as { str: string }).str : ''))
        .join(' ');
      textCache.current.set(pageNo, text);
      return text;
    } catch {
      return '';
    }
  };

  const runSearch = async () => {
    const needle = query.trim().toLowerCase();
    if (!needle || totalPages === 0) return;
    let hit: number | null = null;
    // Forward from the current page, wrapping once — the reader lands on the
    // next page that matches, either in its text layer or in the OCR store.
    for (let offset = 1; offset <= totalPages; offset += 1) {
      const pageNo = ((currentPage - 1 + offset) % totalPages) + 1;
      const pdfText = (await pdfTextOf(pageNo)).toLowerCase();
      const ocrText = (pages?.find((p) => p.pageNo === pageNo)?.ocrText ?? '').toLowerCase();
      if (pdfText.includes(needle) || ocrText.includes(needle)) {
        hit = pageNo;
        break;
      }
    }
    setMatchPage(hit);
    if (hit !== null) setCurrentPage(hit);
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      success('Text copied.');
    } catch {
      danger('The browser blocked clipboard access.');
    }
  };

  const reRunOcr = async () => {
    if (!fileId || !documentId) return;
    setOcrBusy(true);
    try {
      const result = await service.files.runDocumentPageOcr(fileId, documentId, currentPage);
      if (result.ok) {
        setPages((rows) =>
          (rows ?? []).map((row) => (row.pageNo === currentPage ? result.value : row)),
        );
        success(result.value.ocrText.trim() ? `OCR re-run for page ${currentPage}.` : `OCR ran for page ${currentPage} but found no text.`);
      } else {
        danger(result.error);
      }
    } finally {
      setOcrBusy(false);
    }
  };

  const zoom = (delta: number) =>
    setScale((current) => Math.min(2.5, Math.max(0.5, Math.round((current + delta) * 10) / 10)));

  const pageLabel = totalPages > 0 ? `${currentPage} / ${totalPages}` : '—';

  return (
    <div className="overflow-hidden rounded-2xl border border-base bg-[var(--rr-surface)]">
      {/* Toolbar — file identity + one row of reader controls. */}
      <div className="flex flex-col gap-3 border-b border-base p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold">{filename}</p>
            {meta}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toolbarExtra}
          <div className="flex items-center overflow-hidden rounded-lg border border-base">
            <button
              type="button"
              className="focus-ring grid size-8 place-items-center hover:bg-[var(--rr-surface-2)] disabled:opacity-40"
              onClick={goPrev}
              disabled={currentPage <= 1}
              aria-label="Previous page"
              title="Previous page (←)"
            >
              <CaretLeftIcon />
            </button>
            <span className="min-w-14 border-x border-base px-2 py-1.5 text-center text-xs font-semibold">
              {pageLabel}
            </span>
            <button
              type="button"
              className="focus-ring grid size-8 place-items-center hover:bg-[var(--rr-surface-2)] disabled:opacity-40"
              onClick={goNext}
              disabled={totalPages === 0 || currentPage >= totalPages}
              aria-label="Next page"
              title="Next page (→)"
            >
              <CaretRightIcon />
            </button>
          </div>
          <div className="flex items-center overflow-hidden rounded-lg border border-base">
            <button
              type="button"
              className="focus-ring px-2 py-1.5 hover:bg-[var(--rr-surface-2)]"
              onClick={() => zoom(-0.1)}
              aria-label="Zoom out"
            >
              <MagnifyingGlassMinus size={14} />
            </button>
            <span className="min-w-12 border-x border-base px-2 py-1.5 text-center text-xs font-semibold">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              className="focus-ring px-2 py-1.5 hover:bg-[var(--rr-surface-2)]"
              onClick={() => zoom(0.1)}
              aria-label="Zoom in"
            >
              <MagnifyingGlassPlus size={14} />
            </button>
          </div>

          {/* Search reaches the PDF text layer and the stored OCR text. */}
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <div className="relative">
              <MagnifyingGlass
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--rr-muted)]"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search this document…"
                aria-label="Search pages and OCR text"
                className="focus-ring h-9 w-44 rounded-lg border border-base bg-[var(--rr-bg)] pl-8 pr-7 text-xs outline-none sm:w-56"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setMatchPage(null);
                  }}
                  className="focus-ring absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--rr-muted)] hover:text-[var(--rr-text)]"
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </form>

          <button
            type="button"
            onClick={() => setShowOcr((open) => !open)}
            className={cn(
              'focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition',
              showOcr
                ? 'border-[var(--rr-accent)] bg-accent-soft text-accent'
                : 'border-base bg-[var(--rr-bg)] hover:bg-[var(--rr-surface-2)]',
            )}
            aria-pressed={showOcr}
          >
            <TextAa size={14} /> OCR
          </button>
          {url && (
            <>
              <a
                href={url}
                download={filename}
                className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg border border-base bg-[var(--rr-bg)] px-2.5 text-xs font-semibold hover:bg-[var(--rr-surface-2)]"
              >
                <DownloadSimple size={14} /> Download
              </a>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="focus-ring inline-flex h-9 items-center rounded-lg border border-base bg-[var(--rr-bg)] px-2.5 text-xs font-semibold hover:bg-[var(--rr-surface-2)]"
                title="Open in a new tab"
              >
                ↗
              </a>
            </>
          )}
        </div>
      </div>

      {matchPage !== null && (
        <p
          role="status"
          className="border-b border-base bg-[var(--rr-bg)] px-3 py-1.5 text-xs font-semibold"
        >
          {matchPage ? `Found on page ${matchPage}` : `No page matches “${query.trim()}”`}
        </p>
      )}

      {/* Reader body: the page centred, OCR on demand to its right. */}
      {failed ? (
        <div className="grid h-[420px] place-items-center p-6 text-center">
          <div>
            <p className="text-sm font-semibold">This document cannot be previewed.</p>
            <p className="muted mt-1 text-xs">
              {url
                ? 'Download it or open it in a new tab instead.'
                : 'The stored file could not be loaded.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-[540px] flex-col lg:h-[calc(100dvh-16rem)] lg:flex-row">
          <div className="flex min-w-0 flex-1 justify-center overflow-auto bg-[var(--rr-surface-2)] p-4">
            {!url ? (
              <div className="grid h-72 w-full max-w-sm animate-pulse place-items-center rounded-xl bg-[var(--rr-bg)] text-xs muted">
                Loading document…
              </div>
            ) : !isPdfFile(filename) ? (
              <div className="grid min-h-[400px] w-full place-items-center overflow-auto">
                <img
                  src={url}
                  alt={filename}
                  style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
                  className="max-h-[80vh] max-w-full rounded shadow-sm object-contain transition-transform"
                />
              </div>
            ) : (
              <Document
                file={url}
                options={PDF_OPTIONS}
                onLoadSuccess={(pdf) => {
                  pdfRef.current = pdf;
                  setNumPages(pdf.numPages);
                }}
                onLoadError={() => setFailed(true)}
                loading={
                  <div className="grid h-72 w-full max-w-sm place-items-center rounded-xl bg-[var(--rr-bg)] text-xs muted">
                    Loading document…
                  </div>
                }
                error={
                  <div className="grid h-72 place-items-center p-6 text-center text-xs muted">
                    This PDF could not be rendered. Try downloading it.
                  </div>
                }
              >
                <Page
                  key={`${docKey}-${currentPage}-${scale}`}
                  pageNumber={Math.min(Math.max(1, currentPage), Math.max(1, totalPages))}
                  scale={scale}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  className="mx-auto shadow-sm"
                  loading={
                    <div className="h-[600px] w-[440px] animate-pulse rounded bg-[var(--rr-bg)]" />
                  }
                />
              </Document>
            )}
          </div>

          {/* OCR side panel — open only on request. Shows the stored text of
              exactly the page being previewed; re-run is explicit. */}
          {showOcr && (
            <div className="flex max-h-[60vh] w-full flex-col border-t border-base lg:max-h-none lg:w-96 lg:border-l lg:border-t-0">
              <div className="flex items-center justify-between gap-2 border-b border-base px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  <TextAa size={14} className="text-accent" /> OCR text · page {currentPage}
                  {ocrPage?.ocrMethod ? (
                    <Badge tone="neutral">{ocrPage.ocrMethod}</Badge>
                  ) : null}
                </p>
                <div className="flex items-center gap-1">
                  {ocrTextOfCurrent && (
                    <button
                      type="button"
                      onClick={() => void copyText(ocrTextOfCurrent)}
                      className="focus-ring rounded p-1 text-[var(--rr-muted)] hover:text-accent"
                      aria-label="Copy this page's OCR text"
                    >
                      <Copy size={13} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowOcr(false)}
                    className="focus-ring rounded p-1 text-[var(--rr-muted)] hover:text-[var(--rr-text)]"
                    aria-label="Close OCR panel"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {ocrTextOfCurrent ? (
                  <p className="whitespace-pre-wrap break-words font-mono text-[12px] leading-6">
                    {ocrTextOfCurrent}
                  </p>
                ) : (
                  <div className="muted space-y-2 py-6 text-center text-xs leading-5">
                    <TextAa size={22} className="mx-auto text-[var(--rr-muted)]" />
                    <p>No OCR text for this page yet.</p>
                    <p>
                      The background pass fills every page after upload; typed PDFs answer from
                      their own text layer.
                    </p>
                    <button
                      type="button"
                      onClick={() => void reRunOcr()}
                      disabled={ocrBusy || !fileId || !documentId}
                      className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-base bg-[var(--rr-bg)] px-2.5 py-1.5 text-[11px] font-semibold hover:bg-[var(--rr-surface-2)] disabled:opacity-40"
                    >
                      {ocrBusy ? <Spinner size={12} className="animate-spin" /> : <TextAa size={12} />}
                      Run OCR for this page
                    </button>
                  </div>
                )}
              </div>
              {ocrTextOfCurrent && (
                <div className="border-t border-base p-2">
                  <button
                    type="button"
                    onClick={() => void reRunOcr()}
                    disabled={ocrBusy}
                    className="focus-ring inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-base bg-[var(--rr-bg)] px-2.5 py-1.5 text-[11px] font-semibold hover:bg-[var(--rr-surface-2)] disabled:opacity-40"
                  >
                    {ocrBusy ? <Spinner size={12} className="animate-spin" /> : <TextAa size={12} />}
                    Re-run OCR for page {currentPage}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CaretLeftIcon() {
  return <span className="text-xs font-semibold">‹</span>;
}

function CaretRightIcon() {
  return <span className="text-xs font-semibold">›</span>;
}
