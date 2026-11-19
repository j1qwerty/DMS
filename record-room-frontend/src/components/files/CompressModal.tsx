import { useEffect, useState } from 'react';
import { ArrowsDownUp, CheckCircle, Sparkle } from '@phosphor-icons/react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useFlash, useService } from '../../hooks/useService';
import { formatDocumentSize } from '../../lib/document';
import type {
  CompressionEstimate,
  CompressionLevelKey,
  CompressionTarget,
} from '../../services/contracts';
import { cn } from '../../lib/utils';

/**
 * PDF compression dialog (round 5): measured, not guessed. Opening it probes
 * the first pages of the stored version at every level, so each row shows the
 * estimated size and the exact percent saved; the level the source's bytes per
 * page justifies is marked recommended. The result is a new pending build —
 * the original stays untouched and the reviewer signs off the compressed copy.
 */
export function CompressModal({
  target,
  filename,
  onClose,
  onDone,
}: {
  target: CompressionTarget;
  filename: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const service = useService();
  const { success, danger } = useFlash();
  const [level, setLevel] = useState<CompressionLevelKey | null>(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  // Keyed request state (the useQuery pattern): the estimate belongs to one
  // target; a stale response for the previous target never renders, and the
  // reset needs no synchronous setState in the effect.
  const requestKey = `${target.fileId}:${target.source}:${target.id}`;
  const [state, setState] = useState<{
    key: string;
    estimate: CompressionEstimate | null;
    error: string;
  }>({ key: '', estimate: null, error: '' });

  useEffect(() => {
    let live = true;
    service.digitization
      .compressionEstimate(target)
      .then((result) => {
        if (!live) return;
        if (result.ok) {
          setState({ key: requestKey, estimate: result.value, error: '' });
          setLevel(result.value.levels.find((row) => row.recommended)?.level ?? null);
        } else {
          setState({ key: requestKey, estimate: null, error: result.error });
        }
      })
      .catch(() => {
        if (live) {
          setState({
            key: requestKey,
            estimate: null,
            error: 'The PDF could not be read for compression.',
          });
        }
      });
    return () => {
      live = false;
    };
  }, [target, service, requestKey]);

  const estimate = state.key === requestKey ? state.estimate : null;
  const error = state.key === requestKey ? state.error : '';

  const apply = async () => {
    if (!level) return;
    setBusy(true);
    try {
      const result = await service.digitization.applyCompression(target, level, remarks);
      if (!result.ok) {
        danger(result.error);
        return;
      }
      success(
        `${result.value.filename} saved — ${formatDocumentSize(result.value.sizeBytes ?? 0)} (−${result.value.savedPercent}%). Awaiting review.`,
      );
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Compress ${filename}`}
      description={
        estimate
          ? `${formatDocumentSize(estimate.currentBytes)} · ${estimate.pageCount} page(s) — a compressed copy is saved as a new version; the original stays.`
          : undefined
      }
    >
      {error ? (
        <p className="rounded-xl border border-[var(--rr-danger)]/30 bg-[var(--rr-danger)]/10 p-3 text-sm text-[var(--rr-danger)]">
          {error}
        </p>
      ) : !estimate ? (
        <div className="flex items-center gap-3 py-6 text-sm muted">
          <span className="size-2 animate-pulse rounded-full bg-[var(--rr-accent)]" />
          Measuring what each level would produce…
        </div>
      ) : (
        <div className="space-y-4">
          {estimate.notWorthIt && (
            <p className="rounded-xl border border-[var(--rr-warning)]/30 bg-[color-mix(in_srgb,var(--rr-warning)_10%,transparent)] p-3 text-sm text-[var(--rr-warning)]">
              This PDF is already efficient — no level would shrink it meaningfully. Compression is
              most useful for photo-heavy scans.
            </p>
          )}

          <div className="space-y-2">
            {estimate.levels.map((row) => {
              const chosen = level === row.level;
              const savedPct = Math.round(row.savedFraction * 100);
              return (
                <button
                  key={row.level}
                  type="button"
                  disabled={estimate.notWorthIt || row.savedFraction <= 0}
                  onClick={() => setLevel(row.level)}
                  className={cn(
                    'focus-ring flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition disabled:opacity-50',
                    chosen
                      ? 'border-[var(--rr-accent)] bg-accent-soft/40'
                      : 'border-base hover:bg-[var(--rr-surface-2)]',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-5 shrink-0 place-items-center rounded-full border',
                      chosen
                        ? 'border-[var(--rr-accent)] bg-[var(--rr-accent-fill)]'
                        : 'border-base',
                    )}
                  >
                    {chosen && <CheckCircle size={13} className="text-white" weight="fill" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{row.label}</span>
                      {row.recommended && (
                        <Badge tone="info">
                          <Sparkle size={11} className="mr-1" /> Recommended
                        </Badge>
                      )}
                      {savedPct > 0 ? (
                        <Badge tone="success">−{savedPct}%</Badge>
                      ) : (
                        <Badge tone="neutral">no saving</Badge>
                      )}
                    </span>
                    <span className="muted mt-0.5 block text-xs">
                      {formatDocumentSize(row.estimatedBytes)} est. · {row.qualityNote}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <textarea
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            rows={2}
            placeholder="Remark (kept with the version history)"
            className="focus-ring w-full rounded-lg border border-base bg-[var(--rr-bg)] p-3 text-sm outline-none"
          />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              icon={<ArrowsDownUp size={16} />}
              disabled={busy || !level || estimate.notWorthIt}
              onClick={() => void apply()}
            >
              {busy ? 'Compressing…' : 'Compress & save version'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
