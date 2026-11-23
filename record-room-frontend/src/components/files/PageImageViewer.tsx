import { useRef, useState } from 'react';
import {
  ArrowsInSimple,
  ArrowsOutSimple,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
} from '@phosphor-icons/react';

type FitMode = 'fit-page' | 'fit-width' | 'custom';

/**
 * A dedicated interactive viewer for an extracted scan page image.
 *
 * Sizing uses real DOM dimensions rather than CSS transform so the container's
 * scrollbars accurately reflect the page size, allowing full scrolling from
 * top to bottom.
 *
 * Supports Fit to Page, Fit to Width, arbitrary Zoom (25% - 400%), mouse-wheel
 * scrolling, and Ctrl/Cmd-wheel zooming.
 */
export function PageImageViewer({
  src,
  alt,
  controlsPosition = 'bottom',
}: {
  src: string;
  alt: string;
  controlsPosition?: 'bottom' | 'embedded';
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [fitMode, setFitMode] = useState<FitMode>('fit-page');
  const [zoomPercent, setZoomPercent] = useState(100);

  // Reset sizing when the page source changes
  const [prevSrc, setPrevSrc] = useState(src);
  if (src !== prevSrc) {
    setPrevSrc(src);
    setFitMode('fit-page');
  }

  const onImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    setNaturalSize({ width: img.naturalWidth || 800, height: img.naturalHeight || 1100 });
  };

  const handleZoom = (deltaPercent: number) => {
    setFitMode('custom');
    setZoomPercent((current) => Math.min(400, Math.max(25, Math.round(current + deltaPercent))));
  };

  const setFitPage = () => {
    setFitMode('fit-page');
  };

  const setFitWidth = () => {
    setFitMode('fit-width');
  };

  const setActualSize = () => {
    setFitMode('custom');
    setZoomPercent(100);
  };

  // Calculate style based on fitMode
  let imgStyle: React.CSSProperties;
  if (fitMode === 'fit-page') {
    imgStyle = {
      maxHeight: 'calc(100% - 1rem)',
      maxWidth: 'calc(100% - 1rem)',
      width: 'auto',
      height: 'auto',
      objectFit: 'contain',
    };
  } else if (fitMode === 'fit-width') {
    imgStyle = {
      width: '100%',
      maxWidth: '100%',
      height: 'auto',
    };
  } else {
    // Custom zoom percent
    if (naturalSize) {
      const calculatedWidth = (naturalSize.width * zoomPercent) / 100;
      imgStyle = {
        width: `${calculatedWidth}px`,
        maxWidth: 'none',
        height: 'auto',
      };
    } else {
      imgStyle = {
        width: `${zoomPercent}%`,
        maxWidth: 'none',
        height: 'auto',
      };
    }
  }

  return (
    <div className="relative flex h-full w-full min-w-0 flex-1 flex-col overflow-hidden bg-slate-900/90">
      {/* Scrollable document canvas */}
      <div
        ref={containerRef}
        className="flex h-full w-full flex-1 items-center justify-center overflow-auto p-4"
        style={{
          alignItems: fitMode === 'fit-width' || zoomPercent > 120 ? 'flex-start' : 'center',
        }}
        onWheel={(event) => {
          // Ctrl or Cmd + wheel zooms; regular wheel scrolls the page vertically
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            handleZoom(event.deltaY < 0 ? 15 : -15);
          }
        }}
      >
        <img
          src={src}
          alt={alt}
          onLoad={onImageLoad}
          style={imgStyle}
          className="mx-auto block rounded shadow-2xl transition-all duration-75 select-none"
          draggable={false}
        />
      </div>

      {/* Floating Zoom & Fit Controls */}
      {controlsPosition === 'bottom' && (
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-xl border border-white/20 bg-slate-950/85 px-3 py-1.5 text-white shadow-xl backdrop-blur-md">
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out (-)"
            onClick={() => handleZoom(-15)}
            className="focus-ring grid size-7 place-items-center rounded-lg hover:bg-white/15"
          >
            <MagnifyingGlassMinus size={15} />
          </button>
          <button
            type="button"
            onClick={setActualSize}
            title="Reset to 100%"
            className="min-w-12 text-center text-xs font-semibold hover:text-[var(--rr-accent)]"
          >
            {fitMode === 'fit-page' ? 'Fit' : fitMode === 'fit-width' ? 'Width' : `${zoomPercent}%`}
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in (+)"
            onClick={() => handleZoom(15)}
            className="focus-ring grid size-7 place-items-center rounded-lg hover:bg-white/15"
          >
            <MagnifyingGlassPlus size={15} />
          </button>
          <div className="mx-1 h-4 w-px bg-white/20" />
          <button
            type="button"
            onClick={setFitWidth}
            title="Fit to Width"
            className={`focus-ring inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${
              fitMode === 'fit-width' ? 'bg-white/25 text-white' : 'hover:bg-white/15 text-white/80'
            }`}
          >
            <ArrowsOutSimple size={13} /> Fit Width
          </button>
          <button
            type="button"
            onClick={setFitPage}
            title="Fit to Page"
            className={`focus-ring inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${
              fitMode === 'fit-page' ? 'bg-white/25 text-white' : 'hover:bg-white/15 text-white/80'
            }`}
          >
            <ArrowsInSimple size={13} /> Fit Page
          </button>
        </div>
      )}
    </div>
  );
}
