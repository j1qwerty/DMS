import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  MagnifyingGlass,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { pdfjs, Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import type { PDFDocumentProxy } from 'pdfjs-dist';

/**
 * In-app PDF reader (work plan §2.2) — replaces the bare `<iframe>` preview
 * that depended on the browser's PDF plugin. Page navigation, jump-to-page,
 * zoom in/out/fit-width, rotate and a first-pass in-document text search that
 * jumps to the next page containing the query.
 *
 * `src` is an object URL created by the caller (who also owns its lifecycle).
 */

// The worker must be configured in the same module that renders <Document>
// (react-pdf README); a separate setup file can be overwritten by the
// module's own default.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const PDF_OPTIONS = {
  cMapUrl: '/cmaps/',
  standardFontDataUrl: '/standard_fonts/',
  wasmUrl: '/wasm/',
} as const;

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

/** Escape HTML, then wrap query hits in a translucent highlight mark. */
function highlight(str: string, query: string): string {
  const escaped = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (!query) return escaped;
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(
    new RegExp(pattern, 'gi'),
    (hit) => `<mark class="pdf-search-mark">${hit}</mark>`,
  );
}

export function PdfDocumentViewer({
  src,
  filename,
  initialPage = 1,
  heightClassName = 'h-[calc(100dvh-15rem)] min-h-[480px]',
}: {
  src: string;
  filename: string;
  /** 1-based page for deep links (registry rows, map pages). */
  initialPage?: number;
  heightClassName?: string;
}) {
  // Keyed remount per document: a new src resets all reader state without any
  // effect bookkeeping — the new mount starts from the deep-linked page.
  return (
    <PdfViewerInner
      key={src}
      src={src}
      filename={filename}
      initialPage={initialPage}
      heightClassName={heightClassName}
    />
  );
}

function PdfViewerInner({
  src,
  filename,
  initialPage = 1,
  heightClassName,
}: {
  src: string;
  filename: string;
  initialPage?: number;
  heightClassName: string;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [scale, setScale] = useState(1);
  const [fitMode, setFitMode] = useState<'page' | 'width' | 'manual'>('page');
  const [rotation, setRotation] = useState(0);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [matchPage, setMatchPage] = useState<number | null>(null);
  const [pageSizeName, setPageSizeName] = useState<string>('A4');
  const [isLargeFormat, setIsLargeFormat] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window !== 'undefined' ? Math.max(window.innerWidth - 420, 600) : 800,
  );
  const [containerHeight, setContainerHeight] = useState(() =>
    typeof window !== 'undefined' ? Math.max(window.innerHeight - 240, 600) : 800,
  );
  const [pageDim, setPageDim] = useState<{ width: number; height: number }>({
    width: 595,
    height: 842,
  });

  useEffect(() => {
    if (!pdf || pageNumber < 1 || pageNumber > numPages) return;
    let active = true;
    pdf
      .getPage(pageNumber)
      .then((page) => {
        if (!active) return;
        const vp = page.getViewport({ scale: 1 });
        const w = Math.round(vp.width);
        const h = Math.round(vp.height);
        setPageDim({ width: w, height: h });
        const maxDim = Math.max(w, h);
        const minDim = Math.min(w, h);

        let name: string;
        let large = false;
        if (maxDim >= 2800 || minDim >= 2000) {
          name = 'A0 (Map)';
          large = true;
        } else if (maxDim >= 2000 || minDim >= 1400) {
          name = 'A1';
          large = true;
        } else if (maxDim >= 1400 || minDim >= 1000) {
          name = 'A2';
          large = true;
        } else if (maxDim >= 1100) {
          name = 'A3';
          large = true;
        } else if (maxDim >= 950 && minDim >= 580) {
          name = 'Legal';
        } else if (maxDim >= 750 && minDim >= 550) {
          name = 'A4';
        } else {
          name = `${minDim}×${maxDim} pt`;
        }
        setPageSizeName(name);
        setIsLargeFormat(large);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [pdf, pageNumber, numPages]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    if (element.clientWidth > 0) setContainerWidth(element.clientWidth);
    if (element.clientHeight > 0) setContainerHeight(element.clientHeight);

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0) setContainerWidth(width);
        if (height > 0) setContainerHeight(height);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const onLoadSuccess = (loaded: PDFDocumentProxy) => {
    setPdf(loaded);
    setNumPages(loaded.numPages);
    setPageNumber((current) => Math.min(Math.max(current, 1), loaded.numPages));
  };

  const findNext = async (needle: string) => {
    if (!pdf || !needle.trim()) return;
    setSearching(true);
    setMatchPage(null);
    try {
      const target = needle.toLowerCase();
      const start = pageNumber;
      for (let offset = 0; offset < pdf.numPages; offset++) {
        const candidate = ((start - 1 + offset) % pdf.numPages) + 1;
        const page = await pdf.getPage(candidate);
        const content = await page.getTextContent();
        const found = content.items.some(
          (item) => 'str' in item && item.str.toLowerCase().includes(target),
        );
        if (found) {
          setPageNumber(candidate);
          setMatchPage(candidate);
          return;
        }
      }
    } finally {
      setSearching(false);
    }
  };

  const file = useMemo(() => ({ url: src }), [src]);
  const textRenderer = useMemo(
    () => (query.trim() ? ({ str }: { str: string }) => highlight(str, query) : undefined),
    [query],
  );

  let shownWidth: number | undefined;
  if (containerWidth > 0 && pageDim.width > 0) {
    const availW = Math.max(containerWidth - 32, 100);
    const availH = Math.max(containerHeight - 32, 100);

    if (fitMode === 'page') {
      const scaleX = availW / pageDim.width;
      const scaleY = containerHeight > 100 ? availH / pageDim.height : scaleX;
      const autoFitScale = Math.min(scaleX, scaleY);
      shownWidth = Math.round(pageDim.width * autoFitScale * scale);
    } else if (fitMode === 'width') {
      const widthScale = availW / pageDim.width;
      shownWidth = Math.round(pageDim.width * widthScale * scale);
    } else {
      shownWidth = Math.round(pageDim.width * scale);
    }
  }

  return (
    <div className={`flex flex-col ${heightClassName}`}>
      <div className="flex-shrink-0 flex flex-wrap items-center gap-2 border-b border-base px-3 py-2 bg-[var(--rr-surface)]">
        <div className="flex items-center rounded-lg border border-base bg-[var(--rr-surface)]">
          <button
            type="button"
            onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
            disabled={pageNumber <= 1}
            className="focus-ring grid size-9 place-items-center rounded-l-lg hover:bg-[var(--rr-surface-2)] disabled:opacity-50"
            aria-label="Previous page"
          >
            <CaretLeft size={16} />
          </button>
          <input
            value={pageNumber}
            onChange={(event) => {
              const value = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(value)) setPageNumber(value);
            }}
            inputMode="numeric"
            aria-label="Jump to page"
            className="w-14 border-x border-base bg-transparent py-1.5 text-center text-xs font-semibold outline-none"
          />
          <button
            type="button"
            onClick={() => setPageNumber((value) => Math.min(numPages, value + 1))}
            disabled={!numPages || pageNumber >= numPages}
            className="focus-ring grid size-9 place-items-center rounded-r-lg hover:bg-[var(--rr-surface-2)] disabled:opacity-50"
            aria-label="Next page"
          >
            <CaretRight size={16} />
          </button>
        </div>
        <span className="muted text-xs font-semibold">of {numPages || '…'}</span>

        <div className="flex items-center rounded-lg border border-base bg-[var(--rr-surface)]">
          <button
            type="button"
            onClick={() => {
              setFitMode('manual');
              setScale((value) => Math.max(MIN_SCALE, Math.round((value - 0.25) * 100) / 100));
            }}
            className="focus-ring grid size-9 place-items-center rounded-l-lg hover:bg-[var(--rr-surface-2)]"
            aria-label="Zoom out"
            title="Zoom out"
          >
            <MagnifyingGlassMinus size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              setFitMode('page');
              setScale(1);
            }}
            className={`focus-ring min-w-11 border-x border-base px-2 py-1.5 text-center text-xs font-semibold hover:bg-[var(--rr-surface-2)] ${fitMode === 'page' && scale === 1 ? 'text-accent font-bold bg-accent-soft/30' : ''}`}
            aria-label="Fit page"
            title="Fit whole page in view"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => {
              setFitMode('width');
              setScale(1);
            }}
            className={`focus-ring min-w-12 border-r border-base px-2 py-1.5 text-center text-xs font-semibold hover:bg-[var(--rr-surface-2)] ${fitMode === 'width' && scale === 1 ? 'text-accent font-bold bg-accent-soft/30' : ''}`}
            aria-label="Fit width"
            title="Fit page width"
          >
            Width
          </button>
          <button
            type="button"
            onClick={() => {
              setFitMode('manual');
              setScale(1);
            }}
            className={`focus-ring min-w-12 border-r border-base px-2 py-1.5 text-center text-xs font-semibold hover:bg-[var(--rr-surface-2)] ${fitMode === 'manual' && scale === 1 ? 'text-accent font-bold bg-accent-soft/30' : ''}`}
            aria-label="Set to 100% actual size"
            title="100% actual size (1-click)"
          >
            100%
          </button>
          <button
            type="button"
            onClick={() => {
              setFitMode('manual');
              setScale((value) => Math.min(MAX_SCALE, Math.round((value + 0.25) * 100) / 100));
            }}
            className="focus-ring grid size-9 place-items-center rounded-r-lg hover:bg-[var(--rr-surface-2)]"
            aria-label="Zoom in"
            title="Zoom in"
          >
            <MagnifyingGlassPlus size={16} />
          </button>
        </div>
        {scale !== 1 && (
          <span className="muted text-xs font-semibold">{Math.round(scale * 100)}%</span>
        )}
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ${
            isLargeFormat
              ? 'border border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
              : 'border border-base bg-[var(--rr-surface-2)] muted'
          }`}
          title={`Detected sheet size: ${pageSizeName}`}
        >
          {pageSizeName}
        </span>

        <button
          type="button"
          onClick={() => setRotation((value) => (value + 90) % 360)}
          className="focus-ring grid size-9 place-items-center rounded-lg border border-base bg-[var(--rr-surface)] hover:bg-[var(--rr-surface-2)]"
          aria-label="Rotate"
        >
          <ArrowClockwise size={16} />
        </button>

        <div className="ml-auto flex min-w-40 items-center gap-1 rounded-lg border border-base bg-[var(--rr-surface)] pl-2">
          <MagnifyingGlass size={14} className="muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void findNext(query);
              }
            }}
            placeholder="Search in document"
            aria-label="Search in document"
            className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--rr-muted)]"
          />
          <button
            type="button"
            onClick={() => void findNext(query)}
            disabled={searching || !pdf || !query.trim()}
            className="focus-ring m-1 rounded-md px-2 py-1 text-xs font-semibold hover:bg-[var(--rr-surface-2)] disabled:opacity-50"
          >
            {searching ? '…' : 'Find'}
          </button>
          {(matchPage !== null || query.trim()) && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setMatchPage(null);
              }}
              aria-label="Clear search"
              className="focus-ring m-1 rounded-md p-1 hover:bg-[var(--rr-surface-2)]"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-auto bg-surface-muted p-4 flex flex-col items-center justify-start"
      >
        <Document
          file={file}
          options={PDF_OPTIONS}
          suspense={false}
          onLoadSuccess={onLoadSuccess}
          error={
            <div className="grid h-full place-items-center">
              <div className="flex flex-col items-center gap-2 text-center">
                <WarningCircle size={28} className="text-[var(--rr-danger)]" />
                <p className="text-sm font-semibold">Could not load {filename}</p>
                <p className="muted text-xs">The PDF could not be parsed. Use Download instead.</p>
              </div>
            </div>
          }
          loading={
            <div className="grid h-40 place-items-center">
              <span className="muted text-sm">Loading {filename}…</span>
            </div>
          }
          className="mx-auto w-fit flex flex-col items-center"
        >
          <Page
            key={`${pageNumber}-${rotation}-${shownWidth ?? 'auto'}`}
            pageNumber={Math.min(Math.max(pageNumber, 1), Math.max(numPages, 1))}
            rotate={rotation}
            width={shownWidth}
            scale={1}
            customTextRenderer={textRenderer}
            className="shadow-md rounded bg-white overflow-hidden"
            loading={
              <div className="grid h-40 place-items-center">
                <span className="muted text-sm">Rendering page {pageNumber}…</span>
              </div>
            }
            error={
              <div className="muted p-6 text-center text-sm">This page could not be rendered.</div>
            }
          />
        </Document>
        {matchPage !== null && (
          <p role="status" className="muted px-2 py-1 text-center text-xs">
            Found on page {matchPage}
          </p>
        )}
        {pdf && !query.trim() && numPages > 0 && (
          <p role="status" className="sr-only">
            Page {pageNumber} of {numPages}
          </p>
        )}
      </div>
    </div>
  );
}
