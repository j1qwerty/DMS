import { useState } from 'react';
import { MagnifyingGlassMinus, MagnifyingGlassPlus } from '@phosphor-icons/react';

/**
 * A full-page interactive view of one extracted scan page (the studio
 * lightbox's page area). The page image sits at its natural size —
 * `max-width: 100%` — inside a scrollable container, so the whole page stays
 * reachable; the zoom buttons or the wheel grow the image and the scroll
 * area takes over the rest.
 */
export function PageImageViewer({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(1);
  const [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) {
    setPrevSrc(src);
    setZoom(1);
  }

  const zoomBy = (factor: number) =>
    setZoom((current) => Math.min(4, Math.max(0.25, Math.round(current * factor * 100) / 100)));

  return (
    <div
      className="flex flex-1 items-start justify-center overflow-auto bg-surface-muted"
      onWheel={(event) => {
        // Standard wheel zoom on the page; ctrl/meta wheel stays available for
        // browser scroll semantics (page switches elsewhere).
        if (!event.ctrlKey && !event.metaKey) event.preventDefault();
        zoomBy(event.deltaY < 0 ? 1.05 : 0.95);
      }}
    >
      <img
        src={src}
        alt={alt}
        className="block max-w-full shadow-md"
        style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
      />
      <div className="fixed bottom-4 right-4 z-10 flex items-center gap-1 rounded-lg border border-base bg-[var(--rr-surface)] px-2 py-1 shadow-md">
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => zoomBy(0.8)}
          className="focus-ring grid size-8 place-items-center rounded hover:bg-[var(--rr-surface-2)] disabled:opacity-50"
        >
          <MagnifyingGlassMinus size={14} />
        </button>
        <span className="min-w-10 text-center text-[11px] font-semibold text-[var(--rr-muted)]">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => zoomBy(1.25)}
          className="focus-ring grid size-8 place-items-center rounded hover:bg-[var(--rr-surface-2)] disabled:opacity-50"
        >
          <MagnifyingGlassPlus size={14} />
        </button>
      </div>
    </div>
  );
}
