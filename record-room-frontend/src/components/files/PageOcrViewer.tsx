import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Copy,
  DownloadSimple,
  MagnifyingGlass,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  TextAa,
  X,
} from '@phosphor-icons/react';
import { pdfjs, Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Badge } from '../ui/Badge';
import { StatusBadge } from '../ui/Flash';
import { useFlash } from '../../hooks/useService';
import type { FileScan } from '../../types';
import { authoritativeScanRows } from '../../lib/scanMerge';
import { cn } from '../../lib/utils';

/**
 * The document tab's reader: the PDF with a page filmstrip beside it, the
 * OCR text on demand side-by-side, and one search box that reaches both.
 *
 * Search deliberately covers two sources. A typed PDF carries its own text
 * layer, and a scanned PDF often carries none — in that case the same query
 * still answers from the OCR text and lands the reader on the right page,
 * which is the whole point of OCR. Each hit says where it came from.
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

interface SearchHit {
  page: number;
  source: 'PDF text' | 'OCR text' | 'PDF + OCR';
  snippet: string;
}

function snippetAround(text: string, needle: string, radius = 60): string {
  const index = text.toLowerCase().indexOf(needle);
  if (index < 0) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + needle.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

export function PageOcrViewer({
  docKey,
  load,
  filename,
  meta,
  scanPages,
  fileId,
  toolbarExtra,
  showOcr,
  onToggleOcr,
}: {
  /** Changing it re-loads the blob and resets page, zoom, search and cache. */
  docKey: string;
  load: () => Promise<Blob>;
  filename: string;
  meta?: ReactNode;
  scanPages: FileScan[];
  /** For the "open the OCR tab" link of the side panel. */
  fileId?: string;
  toolbarExtra?: ReactNode;
  /** OCR panel open — lifted so the page can widen the preview and show the
   * version picker while OCR is open. */
  showOcr: boolean;
  onToggleOcr: (open: boolean) => void;
}) {
  const { success, danger } = useFlash();

  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [isPdf, setIsPdf] = useState(true);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchHit[] | null>(null);

  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const textCache = useRef(new Map<number, string>());

  const [prevDocKey, setPrevDocKey] = useState(docKey);
  if (prevDocKey !== docKey) {
    setPrevDocKey(docKey);
    setFailed(false);
    setUrl(null);
    setNumPages(0);
    setCurrentPage(1);
    setResults(null);
  }

  // Blob lifecycle: one object URL per docKey, revoked on change/unmount.
  useEffect(() => {
    let live = true;
    let created: string | null = null;
    textCache.current.clear();
    pdfRef.current = null;
    load()
      .then((blob) => {
        if (!live) return;
        const pdf = isPdfFile(filename, blob.type);
        setIsPdf(pdf);
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

  // OCR text per rendered page: one authoritative row per page number — the
  // approved row the file shows as current, else the latest row. A studio
  // draft appended for the same page number must not shadow it (issue 2).
  const scanByPage = useMemo(() => {
    const map = new Map<number, FileScan>();
    for (const scan of authoritativeScanRows(scanPages)) {
      map.set(scan.pageIndex ?? scan.pageNo, scan);
    }
    return map;
  }, [scanPages]);

  const ocrByPage = useMemo(() => {
    const map = new Map<number, string>();
    for (const [key, scan] of scanByPage) map.set(key, scan.ocrText ?? '');
    return map;
  }, [scanByPage]);

  const scanOfPage = useMemo(() => scanByPage.get(currentPage), [scanByPage, currentPage]);

  const pdfTextOf = async (pageNo: number): Promise<string> => {
    const cached = textCache.current.get(pageNo);
    if (cached !== undefined) return cached;
    const pdf = pdfRef.current;
    if (!pdf || pageNo < 1 || pageNo > pdf.numPages) return '';
    try {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
      textCache.current.set(pageNo, text);
      return text;
    } catch {
      return '';
    }
  };

  const runSearch = async () => {
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    setSearching(true);
    try {
      const total = Math.max(numPages, ...(ocrByPage.size ? [...ocrByPage.keys()] : [0]));
      const hits: SearchHit[] = [];
      for (let pageNo = 1; pageNo <= total; pageNo += 1) {
        const pdfText = (await pdfTextOf(pageNo)).toLowerCase();
        const ocrText = (ocrByPage.get(pageNo) ?? '').toLowerCase();
        const inPdf = pdfText.includes(needle);
        const inOcr = ocrText.includes(needle);
        if (!inPdf && !inOcr) continue;
        const source: SearchHit['source'] =
          inPdf && inOcr ? 'PDF + OCR' : inPdf ? 'PDF text' : 'OCR text';
        hits.push({
          page: pageNo,
          source,
          snippet: snippetAround(
            inPdf ? (textCache.current.get(pageNo) ?? '') : (ocrByPage.get(pageNo) ?? ''),
            needle,
          ),
        });
      }
      setResults(hits);
    } finally {
      setSearching(false);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      success('Text copied.');
    } catch {
      danger('The browser blocked clipboard access.');
    }
  };

  const zoom = (delta: number) =>
    setScale((current) => Math.min(2.5, Math.max(0.5, Math.round((current + delta) * 10) / 10)));

  const pageLabel = numPages > 0 ? `${currentPage} / ${numPages}` : '—';
  const ocrTextOfCurrent = ocrByPage.get(currentPage)?.trim() ?? '';

  return (
    <div className="overflow-hidden rounded-2xl border border-base bg-[var(--rr-surface)]">
      {/* Toolbar */}
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
              className="focus-ring px-2 py-1.5 hover:bg-[var(--rr-surface-2)] disabled:opacity-40"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPage <= 1}
              aria-label="Previous page"
            >
              <span className="text-xs font-semibold">‹</span>
            </button>
            <span className="min-w-14 border-x border-base px-2 py-1.5 text-center text-xs font-semibold">
              {pageLabel}
            </span>
            <button
              type="button"
              className="focus-ring px-2 py-1.5 hover:bg-[var(--rr-surface-2)] disabled:opacity-40"
              onClick={() => setCurrentPage((page) => Math.min(numPages, page + 1))}
              disabled={numPages === 0 || currentPage >= numPages}
              aria-label="Next page"
            >
              <span className="text-xs font-semibold">›</span>
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

          {/* One search across the PDF text layer and the OCR text. */}
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
                    setResults(null);
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
            onClick={() => onToggleOcr(!showOcr)}
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

      {/* Search results — per page, with the source the hit came from. */}
      {results !== null && (
        <div className="max-h-56 space-y-1.5 overflow-y-auto border-b border-base bg-[var(--rr-bg)] p-3">
          <p className="flex items-center justify-between text-xs font-semibold">
            <span>
              {searching ? 'Searching…' : `${results.length} page(s) match “${query.trim()}”`}
            </span>
            <button
              type="button"
              onClick={() => setResults(null)}
              className="focus-ring muted rounded p-1 hover:text-[var(--rr-text)]"
              aria-label="Close results"
            >
              <X size={13} />
            </button>
          </p>
          {!searching && results.length === 0 && (
            <p className="muted py-2 text-xs">
              No page matches — neither in the PDF text layer nor in the OCR text.
            </p>
          )}
          {results.map((hit) => (
            <button
              key={`${hit.page}-${hit.source}`}
              type="button"
              onClick={() => setCurrentPage(hit.page)}
              className="focus-ring block w-full rounded-lg border border-base bg-[var(--rr-surface)] p-2.5 text-left transition hover:border-[var(--rr-accent)]"
            >
              <span className="flex items-center gap-2 text-xs font-semibold">
                Page {hit.page}
                <Badge
                  tone={
                    hit.source === 'PDF text'
                      ? 'info'
                      : hit.source === 'OCR text'
                        ? 'success'
                        : 'neutral'
                  }
                >
                  {hit.source}
                </Badge>
              </span>
              {hit.snippet && (
                <span className="muted mt-1 block truncate text-[11px] leading-5">
                  {hit.snippet}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Reader body: filmstrip + page + OCR panel */}
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
            ) : !isPdf ? (
              <div className="grid min-h-[400px] w-full place-items-center overflow-auto">
                <img
                  src={url}
                  alt={filename}
                  style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
                  className="max-h-[80vh] max-w-full rounded shadow-sm object-contain transition-transform"
                />
              </div>
            ) : (
              // react-pdf 11 suspends by default while it loads a document.
              // The boundary must be HERE, next to the reader: without it the
              // suspension bubbles to the app-shell Suspense in App.tsx, which
              // unmounts the whole shell into its "Loading…" fallback and, on
              // reveal, reconnects every effect in the tree. PageOcrViewer's
              // blob effect is among them, so it re-fetched the document,
              // created a NEW object URL, and react-pdf — keyed on the file —
              // suspended again: the entire page kept "refreshing" in a loop.
              <Suspense
                fallback={
                  <div className="grid h-72 w-full max-w-sm animate-pulse place-items-center rounded-xl bg-[var(--rr-bg)] text-xs muted">
                    Loading document…
                  </div>
                }
              >
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
                    pageNumber={Math.min(Math.max(1, currentPage), Math.max(1, numPages))}
                    scale={scale}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    className="mx-auto shadow-sm"
                    loading={
                      <div className="h-[600px] w-[440px] animate-pulse rounded bg-[var(--rr-bg)]" />
                    }
                  />
                </Document>
              </Suspense>
            )}
          </div>

          {/* OCR side panel — open only on request, so the default view is the scan. */}
          {showOcr && (
            <div className="flex max-h-[60vh] w-full flex-col border-t border-base lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
              <div className="flex items-center justify-between gap-2 border-b border-base px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  <TextAa size={14} className="text-accent" /> OCR text · page {currentPage}
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
                    onClick={() => onToggleOcr(false)}
                    className="focus-ring rounded p-1 text-[var(--rr-muted)] hover:text-[var(--rr-text)]"
                    aria-label="Close OCR panel"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {scanOfPage && (
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={scanOfPage.status} />
                    <span className="muted text-[11px]">
                      v{scanOfPage.version}
                      {scanOfPage.dpi ? ` · ${scanOfPage.dpi} DPI` : ''}
                    </span>
                  </div>
                )}
                {ocrTextOfCurrent ? (
                  <p className="whitespace-pre-wrap break-words font-mono text-[12px] leading-6">
                    {ocrTextOfCurrent}
                  </p>
                ) : (
                  <div className="muted space-y-2 py-6 text-center text-xs leading-5">
                    <TextAa size={22} className="mx-auto text-[var(--rr-muted)]" />
                    <p>No OCR text for this page.</p>
                    <p>
                      Scanned pages get their text from the background OCR pass; typed PDFs keep
                      theirs in the text layer (the search box still reaches it).
                    </p>
                    {fileId && (
                      <Link
                        to={`/files/${fileId}/ocr`}
                        className="focus-ring inline-block font-semibold text-accent"
                      >
                        Open the OCR tab to run or fix it →
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
