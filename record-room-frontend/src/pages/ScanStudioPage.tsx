/**
 * Scan composition studio (work plan §3.4): the gallery that turns "stored
 * scans" into "digitized properly". Thumbnail grid with drag-to-reorder,
 * per-page rotate / enhance / compare / duplicate / revert, and the deliverable
 * PDF built from the approved pages (§3.5). The original scan is never
 * modified — enhancements write a processed copy server-side.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowsInLineHorizontal,
  Copy,
  FilePdf,
  FloppyDisk,
  MagnifyingGlass,
  Trash,
  ArrowUUpLeft,
} from '@phosphor-icons/react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { StatusBadge } from '../components/ui/Flash';
import { service } from '../services';
import type { DocumentDerivative, FileScan } from '../types';

const ENHANCEMENTS = ['deskew', 'despeckle', 'binarize', 'crop', 'contrast'] as const;

export function ScanStudioPage() {
  const { fileId } = useParams<{ fileId: string }>();
  const [scans, setScans] = useState<FileScan[]>([]);
  const [derivatives, setDerivatives] = useState<DocumentDerivative[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [fileNumber, setFileNumber] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [orderDirty, setOrderDirty] = useState(false);
  const [compare, setCompare] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);

  const reload = useCallback(async () => {
    if (!fileId) return;
    const [file, pages, pdfs] = await Promise.all([
      service.files.get(fileId),
      service.digitization.list(fileId),
      service.digitization.listPdfs(fileId),
    ]);
    setFileNumber(file?.fileNumber ?? fileId);
    setScans(pages);
    setDerivatives(pdfs);
    setOrderDirty(false);
    const urls: Record<string, string> = {};
    await Promise.all(
      pages
        .filter((page) => page.hasDocument)
        .map(async (page) => {
          try {
            const blob = await service.digitization.scanBlob(page.id, 'processed');
            urls[page.id] = URL.createObjectURL(blob);
          } catch {
            /* a missing blob keeps the card's placeholder */
          }
        }),
    );
    setPreviews((previous) => {
      Object.values(previous).forEach((url) => URL.revokeObjectURL(url));
      return urls;
    });
  }, [fileId]);

  useEffect(() => {
    // Deferred so the first paint is not blocked by blob fetching.
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The operation failed.');
    }
    setBusy(false);
  };

  const move = (from: string, to: string) => {
    setScans((rows) => {
      const next = [...rows];
      const fromIndex = next.findIndex((row) => row.id === from);
      const toIndex = next.findIndex((row) => row.id === to);
      if (fromIndex < 0 || toIndex < 0) return rows;
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setOrderDirty(true);
  };

  const patch = (scanId: string, updater: (page: FileScan) => FileScan) =>
    setScans((rows) => rows.map((row) => (row.id === scanId ? updater(row) : row)));

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={`File ${fileNumber}`}
        title="Scan studio"
        description="Compose the digitized file: reorder pages, correct alignment and quality, compare against the original, then build the deliverable PDF from the approved pages."
      />

      {message && <p className="text-xs text-[var(--rr-success)]">{message}</p>}
      {error && <p className="text-xs text-[var(--rr-danger)]">{error}</p>}

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold">
            Pages <span className="muted">({scans.length})</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<FloppyDisk size={16} />}
              disabled={!orderDirty || busy}
              onClick={() =>
                run(async () => {
                  const result = await service.digitization.reorder(
                    fileId ?? '',
                    scans.map((row) => row.id),
                  );
                  if (result.ok) {
                    setScans(result.value);
                    setOrderDirty(false);
                    setMessage('Page order saved.');
                  } else setError(result.error ?? 'The order could not be saved.');
                })
              }
            >
              Save order
            </Button>
            <Button
              icon={<FilePdf size={16} />}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const result = await service.digitization.buildPdf(fileId ?? '');
                  if (result.ok) {
                    setMessage(`${result.value.filename} built from approved pages.`);
                    await reload();
                  } else setError(result.error ?? 'The PDF could not be built.');
                })
              }
            >
              Build deliverable PDF
            </Button>
            <Link className="text-xs underline" to={`/files/${fileId}`}>
              Back to file
            </Link>
          </div>
        </div>

        {scans.length === 0 ? (
          <p className="muted text-sm">
            No scan pages yet — add page scans on the file page first.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {scans.map((scan, index) => (
              <div
                key={scan.id}
                draggable
                onDragStart={() => (dragId.current = scan.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragId.current && dragId.current !== scan.id) move(dragId.current, scan.id);
                  dragId.current = null;
                }}
                className="rounded-xl border border-base bg-[var(--rr-bg)] p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">
                    #{index + 1} · page {scan.pageNo} · v{scan.version}
                  </span>
                  <StatusBadge status={scan.status} />
                </div>

                <div className="grid aspect-[3/4] place-items-center overflow-hidden rounded-lg bg-[var(--rr-surface-2)]">
                  {previews[scan.id] ? (
                    <img
                      src={previews[scan.id]}
                      alt={`Page ${scan.pageNo}`}
                      className="max-h-full max-w-full object-contain"
                      style={
                        scan.enhancement?.startsWith('rotated 90') ||
                        scan.enhancement?.startsWith('rotated 270')
                          ? { transform: 'rotate(90deg)' }
                          : undefined
                      }
                    />
                  ) : (
                    <span className="muted text-xs">No stored image</span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {scan.enhancement && <Badge tone="info">{scan.enhancement}</Badge>}
                  {scan.dpi && <Badge tone="neutral">{scan.dpi} DPI</Badge>}
                  <Badge tone="neutral">{scan.documentSize}</Badge>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    aria-label="Rotate left"
                    onClick={() =>
                      run(async () => {
                        const result = await service.digitization.rotate(scan.id, 270);
                        if (result.ok) patch(scan.id, () => result.value);
                        else setError(result.error ?? 'Rotation failed.');
                      })
                    }
                  >
                    <ArrowCounterClockwise size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    aria-label="Rotate right"
                    onClick={() =>
                      run(async () => {
                        const result = await service.digitization.rotate(scan.id, 90);
                        if (result.ok) patch(scan.id, () => result.value);
                        else setError(result.error ?? 'Rotation failed.');
                      })
                    }
                  >
                    <ArrowClockwise size={14} />
                  </Button>
                  <select
                    className="h-8 rounded-lg border border-base bg-[var(--rr-surface)] px-2 text-xs"
                    defaultValue=""
                    disabled={busy}
                    aria-label="Enhance page"
                    onChange={(event) => {
                      const operation = event.target.value;
                      event.target.value = '';
                      if (!operation) return;
                      void run(async () => {
                        const result = await service.digitization.enhance(scan.id, operation);
                        if (result.ok) patch(scan.id, () => result.value);
                        else setError(result.error ?? 'Enhancement failed.');
                      });
                    }}
                  >
                    <option value="">Enhance…</option>
                    {ENHANCEMENTS.map((operation) => (
                      <option key={operation} value={operation}>
                        {operation}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !scan.hasProcessed}
                    aria-label="Compare with original"
                    onClick={() => setCompare(compare === scan.id ? null : scan.id)}
                  >
                    <ArrowsInLineHorizontal size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    aria-label="Duplicate page"
                    onClick={() =>
                      run(async () => {
                        const result = await service.digitization.duplicate(scan.id);
                        if (result.ok) await reload();
                        else setError(result.error ?? 'Duplicate failed.');
                      })
                    }
                  >
                    <Copy size={14} />
                  </Button>
                  {scan.hasProcessed && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      aria-label="Revert to original"
                      onClick={() =>
                        run(async () => {
                          const result = await service.digitization.revert(scan.id);
                          if (result.ok) patch(scan.id, () => result.value);
                          else setError(result.error ?? 'Revert failed.');
                        })
                      }
                    >
                      <ArrowUUpLeft size={14} />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    aria-label="Delete page"
                    onClick={() =>
                      run(async () => {
                        const result = await service.digitization.remove(scan.id);
                        if (result.ok) await reload();
                        else setError(result.error ?? 'Delete failed.');
                      })
                    }
                  >
                    <Trash size={14} />
                  </Button>
                </div>

                {compare === scan.id && (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                    <div>
                      <p className="muted mb-1">Original</p>
                      <div className="grid aspect-[3/4] place-items-center rounded bg-[var(--rr-surface-2)]">
                        {scan.hasDocument ? (
                          <span className="muted">
                            <MagnifyingGlass size={16} /> stored scan
                          </span>
                        ) : (
                          <span className="muted">no document</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="muted mb-1">Processed</p>
                      <div className="grid aspect-[3/4] place-items-center rounded bg-[var(--rr-surface-2)]">
                        {previews[scan.id] ? (
                          <img
                            src={previews[scan.id]}
                            alt="Processed"
                            className="max-h-full object-contain"
                          />
                        ) : (
                          <span className="muted">no processed copy</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <p className="mb-4 text-sm font-semibold">
          Deliverable PDFs <span className="muted">({derivatives.length})</span>
        </p>
        {derivatives.length === 0 ? (
          <p className="muted text-sm">
            Nothing built yet. Approve pages in the review queue, then “Build deliverable PDF”.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--rr-border)]">
            {derivatives.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{item.filename}</p>
                  <p className="muted text-xs">
                    {item.pageCount} page(s) ·{' '}
                    {item.sizeBytes ? `${Math.max(1, Math.round(item.sizeBytes / 1024))} KB` : '—'}
                    {item.includesOcrText ? ' · searchable text layer' : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<FilePdf size={15} />}
                  onClick={async () => {
                    const blob = await service.digitization.pdfBlob(item.id);
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = item.filename;
                    anchor.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Download
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
