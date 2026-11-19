import type { CompressionLevelEstimate, CompressionLevelKey } from '../services/contracts';

/**
 * PDF compression levels (round 5). The engine rasterizes each page with pdf.js
 * at `scale` and re-encodes it as JPEG at `quality`, so the trade-off is
 * explicit: higher scale keeps fine print readable, higher quality keeps tone
 * gradients clean. Scanned government pages are mostly text, which JPEG
 * compresses hard without visible loss at the balanced level.
 */
export interface CompressionLevelDef {
  key: CompressionLevelKey;
  label: string;
  /** pdf.js viewport scale for the raster pass (2 ≈ 144 dpi, 1.5 ≈ 108 dpi). */
  scale: number;
  /** Canvas JPEG quality, 0–1. */
  quality: number;
  qualityNote: string;
}

export const COMPRESSION_LEVELS: readonly CompressionLevelDef[] = [
  {
    key: 'light',
    label: 'Light',
    scale: 2,
    quality: 0.82,
    qualityNote: 'Near-original detail; smallest saving',
  },
  {
    key: 'balanced',
    label: 'Balanced',
    scale: 1.5,
    quality: 0.65,
    qualityNote: 'Text stays crisp; best size-to-quality trade-off',
  },
  {
    key: 'strong',
    label: 'Strong',
    scale: 1,
    quality: 0.45,
    qualityNote: 'Smallest file; fine print may soften',
  },
] as const;

/**
 * Picks the recommended level from the source's average bytes per page, so the
 * choice is explainable: heavy scans have the head-room for the strong level,
 * while an already-lean PDF is told to stay at light (or not compress at all —
 * the caller handles that case).
 *
 * Thresholds come from the rasterizer's behaviour: a 200-dpi A4 text page
 * re-encoded at balanced lands around 120–180 KB, so sources below 150 KB/page
 * have little to give, and sources above 400 KB/page are photo/duplex scans
 * that the strong level halves without hurting legibility.
 */
export function recommendLevel(bytesPerPage: number): CompressionLevelKey {
  if (!Number.isFinite(bytesPerPage) || bytesPerPage <= 0) return 'light';
  if (bytesPerPage >= 400 * 1024) return 'strong';
  if (bytesPerPage >= 150 * 1024) return 'balanced';
  return 'light';
}

/** Turns probe results into the per-level estimate rows the dialog renders. */
export function buildLevelEstimates(
  currentBytes: number,
  pageCount: number,
  perLevelBytes: Record<CompressionLevelKey, number>,
): CompressionLevelEstimate[] {
  const recommended = recommendLevel(currentBytes / Math.max(1, pageCount));
  return COMPRESSION_LEVELS.map((def) => ({
    level: def.key,
    label: def.label,
    estimatedBytes: perLevelBytes[def.key],
    savedFraction: currentBytes > 0 ? 1 - perLevelBytes[def.key] / currentBytes : 0,
    qualityNote: def.qualityNote,
    recommended: def.key === recommended,
  }));
}
