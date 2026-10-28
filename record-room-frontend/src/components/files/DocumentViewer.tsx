import { useEffect, useState, lazy, Suspense, type ReactNode } from 'react';
import {
  ArrowSquareOut,
  DownloadSimple,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  WarningCircle,
} from '@phosphor-icons/react';
import { pdfPageFragment } from '../../lib/document';
import { Button } from '../ui/Button';

// The PDF.js stack (~650 kB) is only worth paying for when a PDF preview is
// actually opened, so the reader loads on demand.
const PdfDocumentViewer = lazy(() =>
  import('./PdfDocumentViewer').then((module) => ({ default: module.PdfDocumentViewer })),
);

interface ViewerState {
  key: string;
  url: string | null;
  type: string;
  error: string | null;
}

function inferType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  return '';
}

/**
 * Fetches one stored document and shows it inline.
 *
 * `docKey` identifies the document: change it and the previous object URL is
 * revoked and the new blob is fetched. Loading is derived from the key instead
 * of being set in the effect, which keeps the effect free of synchronous
 * state writes.
 *
 * `fill` is for full-page use: the viewer takes the remaining screen height, shows a
 * toolbar with Download / Open in new tab, and zooms images.
 */
export function DocumentViewer({
  docKey,
  load,
  filename,
  contentType,
  pageIndex,
  fill = false,
  toolbar,
}: {
  docKey: string;
  load: () => Promise<Blob>;
  filename: string;
  contentType?: string;
  pageIndex?: number;
  fill?: boolean;
  /** Extra controls placed at the start of the toolbar (fill mode). */
  toolbar?: ReactNode;
}) {
  const [state, setState] = useState<ViewerState>({ key: '', url: null, type: '', error: null });
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    let live = true;
    let created: string | null = null;
    load().then(
      (blob) => {
        if (!live) return;
        const type = blob.type || contentType || inferType(filename);
        const typed = blob.type ? blob : new Blob([blob], { type });
        created = URL.createObjectURL(typed);
        setState({ key: docKey, url: created, type, error: null });
      },
      (cause: unknown) => {
        if (!live) return;
        setState({
          key: docKey,
          url: null,
          type: '',
          error: cause instanceof Error ? cause.message : 'Could not load this document.',
        });
      },
    );
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
    // `load` closes over the same ids that make up `docKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  const loading = state.key !== docKey;
  const isPdf = state.type === 'application/pdf';
  const isImage = state.type.startsWith('image/');
  const src = state.url ? `${state.url}${isPdf ? pdfPageFragment(pageIndex) : ''}` : null;
  const height = fill
    ? 'h-[calc(100dvh-17rem)] min-h-[420px] lg:h-[calc(100dvh-14rem)]'
    : 'h-[58dvh]';

  const download = () => {
    if (!state.url) return;
    const anchor = document.createElement('a');
    anchor.href = state.url;
    anchor.download = filename || 'document';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const actions = (
    <>
      {isImage && fill && (
        <div className="flex items-center rounded-lg border border-base bg-[var(--rr-surface)]">
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(50, value - 25))}
            className="focus-ring grid size-9 place-items-center rounded-l-lg hover:bg-[var(--rr-surface-2)]"
            aria-label="Zoom out"
          >
            <MagnifyingGlassMinus size={17} />
          </button>
          <span className="w-12 text-center text-xs font-semibold">{zoom}%</span>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(300, value + 25))}
            className="focus-ring grid size-9 place-items-center rounded-r-lg hover:bg-[var(--rr-surface-2)]"
            aria-label="Zoom in"
          >
            <MagnifyingGlassPlus size={17} />
          </button>
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={download}
        disabled={!state.url}
        icon={<DownloadSimple size={16} />}
      >
        Download
      </Button>
      <a
        href={src ?? undefined}
        target="_blank"
        rel="noreferrer"
        aria-disabled={!src}
        className="focus-ring inline-flex min-h-9 items-center gap-2 rounded-lg border border-base bg-[var(--rr-surface)] px-3 text-[13px] font-semibold hover:bg-[var(--rr-surface-2)] aria-disabled:pointer-events-none aria-disabled:opacity-50"
      >
        <ArrowSquareOut size={16} /> Open in new tab
      </a>
    </>
  );

  let body: ReactNode;
  if (loading) {
    body = (
      <div role="status" className={`grid ${height} place-items-center text-sm muted`}>
        <span className="flex items-center gap-2.5">
          <span className="size-2 animate-pulse rounded-full bg-[var(--rr-accent)]" />
          Opening {filename}…
        </span>
      </div>
    );
  } else if (state.error || !src) {
    body = (
      <div
        role="alert"
        className={`flex ${fill ? height : 'h-[40dvh]'} flex-col items-center justify-center gap-2 p-6 text-center`}
      >
        <WarningCircle size={28} className="text-[var(--rr-danger)]" />
        <p className="text-sm font-semibold">This document could not be opened</p>
        <p className="muted max-w-sm text-sm">{state.error}</p>
      </div>
    );
  } else if (isPdf) {
    body = (
      <Suspense
        fallback={
          <div className={`muted grid ${height} place-items-center text-sm`}>Loading reader…</div>
        }
      >
        <PdfDocumentViewer
          src={state.url!}
          filename={filename}
          initialPage={pageIndex}
          heightClassName={height}
        />
      </Suspense>
    );
  } else if (isImage) {
    body = (
      <div className={`${height} overflow-auto p-2`}>
        <img
          src={src}
          alt={filename}
          style={{ width: `${zoom}%`, maxWidth: zoom <= 100 ? '100%' : 'none' }}
          className="mx-auto h-auto"
        />
      </div>
    );
  } else {
    body = (
      <p className="muted p-6 text-sm">
        This format cannot be previewed in the browser. Use Download instead.
      </p>
    );
  }

  return (
    <div className="min-w-0">
      {fill && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {toolbar}
          <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-base bg-[var(--rr-bg)]">{body}</div>
      {!fill && !loading && src && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
