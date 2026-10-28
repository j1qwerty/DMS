import { useEffect, useState } from 'react';
import { useService } from './useService';

const cache = new Map<string, string>();
const MAX_LOOKUPS = 60;

/**
 * Maps a file's internal id (its barcode value) to the file number people read.
 *
 * Needed where a row only carries the internal id, such as map pages, and barcodes are
 * switched off: the id must not be shown, so the file number is looked up instead. Does
 * nothing (and makes no requests) when `enabled` is false.
 */
export function useFileLabels(ids: string[], enabled: boolean): Record<string, string> {
  const service = useService();
  const [version, setVersion] = useState(0);
  const key = enabled ? [...new Set(ids)].sort().join('|') : '';

  useEffect(() => {
    if (!key) return;
    let live = true;
    // Bounded: a long list must not turn into hundreds of requests. The API sends
    // `fileNumber` on these rows, which makes the lookup unnecessary.
    const missing = key
      .split('|')
      .filter((id) => id && !cache.has(id))
      .slice(0, MAX_LOOKUPS);
    if (missing.length === 0) return;
    Promise.all(
      missing.map(async (id) => {
        const file = await service.files.byBarcode(id).catch(() => null);
        cache.set(id, file?.fileNumber ?? '');
      }),
    ).then(() => live && setVersion((value) => value + 1));
    return () => {
      live = false;
    };
  }, [key, service]);

  // `version` only exists to re-render once lookups land.
  void version;
  const out: Record<string, string> = {};
  for (const id of key ? key.split('|') : []) out[id] = cache.get(id) ?? '';
  return out;
}
