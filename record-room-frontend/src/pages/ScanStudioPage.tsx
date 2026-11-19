/**
 * Scan composition studio (work plan §3.4): the gallery that turns "stored
 * scans" into "digitized properly". Thumbnail grid with drag-to-reorder,
 * per-page rotate / enhance / compare / duplicate / revert, and the deliverable
 * PDF built from the approved pages (§3.5). The original scan is never
 * modified — enhancements write a processed copy server-side.
 *
 * Round 4: the studio is the digitization workbench. Pages can be scanned /
 * uploaded right here (one or many images or PDFs), and a freshly built PDF is
 * "Pending approval" — a reviewer verifies the final composition (added,
 * reordered, removed pages) before it counts as the file's deliverable. Every
 * build, approved or not, stays in the history for tracking.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowsInLineHorizontal,
  CheckCircle,
  Copy,
  FilePdf,
  FloppyDisk,
  MagnifyingGlass,
  Plus,
  TextAa,
  Trash,
  ArrowUUpLeft,
  UploadSimple,
  XCircle,
} from '@phosphor-icons/react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Field, TextArea } from '../components/ui/Field';
import { StatusBadge } from '../components/ui/Flash';
import { service } from '../services';
import { useSession } from '../hooks/useService';
import { documentAcceptAttribute } from '../lib/document';
import type { DocumentDerivative, FileScan } from '../types';

const ENHANCEMENTS = ['deskew', 'despeckle', 'binarize', 'crop', 'contrast'] as const;

export function ScanStudioPage() {
  const { fileId } = useParams<{ fileId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { allowed } = useSession();
  const canUploadPages = allowed('digitization.upload');
  const canReview = allowed('digitization.review');

  const [scans, setScans] = useState<FileScan[]>([]);
  const [derivatives, setDerivatives] = useState<DocumentDerivative[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [fileNumber, setFileNumber] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [orderDirty, setOrderDirty] = useState(false);
  const [compare, setCompare] = useState<string | null>(null);
  const [ocr, setOcr] = useState<Record<string, { text: string; method: string }>>({});
  const [rejectingPdf, setRejectingPdf] = useState<DocumentDerivative | null>(null);
  const dragId = useRef<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

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

  /**
   * The scanner entry (round 4): pick one or many images / PDFs from the
   * scanner's output folder; each becomes the next page of this file with its
   * bytes attached, exactly like a page scan from the file page — including
   * the trip through the review queue.
   */
  const addPages = async (files: File[]) => {
    if (files.length === 0 || !fileId) return;
    setUploading(true);
    setError('');
    try {
      let pageNo = scans.reduce((max, row) => Math.max(max, row.pageNo), 0);
      const failures: string[] = [];
      for (const upload of files) {
        const added = await service.digitization.add(fileId, {
          pageNo: pageNo + 1,
          filename: upload.name,
          documentSize: '',
          note: 'Uploaded in the scan studio.',
        });
        if (!added.ok) {
          failures.push(`${upload.name}: ${added.error}`);
          continue;
        }
        const withDocument = await service.digitization.addDocument(added.value.id, upload);
        if (!withDocument.ok) failures.push(`${upload.name}: ${withDocument.error}`);
        pageNo += 1;
      }
      await reload();
      if (failures.length > 0) setError(failures.join(' · '));
      else
        setMessage(
          `${files.length} page(s) added — they await review in the Digitization queue before they can be built into the PDF.`,
        );
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  const onUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    void addPages(Array.from(event.target.files ?? []));
  };

  const reviewPdf = async (
    item: DocumentDerivative,
    decision: 'Approved' | 'Rejected',
    note = '',
  ) => {
    await run(async () => {
      const result = await service.digitization.reviewPdf(item.id, decision, note);
      if (result.ok) {
        setMessage(`${item.filename} ${decision.toLowerCase()}.`);
        await reload();
      } else setError(result.error ?? 'The review could not be saved.');
    });
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
      <button
        onClick={() =>
          (location.state as { from?: string } | null)?.from
            ? navigate((location.state as { from?: string }).from as string)
            : navigate(`/files/${fileId}`)
        }
        className="focus-ring inline-flex items-center gap-2 text-xs font-semibold muted hover:text-[var(--rr-text)]"
      >
        <ArrowLeft size={15} /> Back
      </button>

      <PageHeader
        kicker={`File ${fileNumber}`}
        title="Scan studio"
        description="Scan or upload the pages, compose them — reorder, replace, rotate, enhance — then build the deliverable PDF. The original images are always kept; every built PDF waits for reviewer approval and stays in the history."
        actions={
          <>
            {canUploadPages && (
              <label className="focus-ring inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-base bg-[var(--rr-surface)] px-4 text-sm font-semibold hover:bg-[var(--rr-surface-2)]">
                <UploadSimple size={17} className="text-accent" />
                {uploading ? 'Adding…' : 'Scan / add pages'}
                <input
                  ref={uploadRef}
                  type="file"
                  multiple
                  accept={documentAcceptAttribute()}
                  onChange={onUploadChange}
                  className="hidden"
                  disabled={uploading}
                />
              </label>
            )}
            <Link className="text-xs underline" to={`/files/${fileId}`}>
              Back to file
            </Link>
          </>
        }
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
                    setMessage(
                      `${result.value.filename} built from approved pages — it now awaits reviewer approval below.`,
                    );
                    await reload();
                  } else setError(result.error ?? 'The PDF could not be built.');
                })
              }
            >
              Build deliverable PDF
            </Button>
          </div>
        </div>

        {canUploadPages && (
          <div className="mb-4 rounded-xl border border-dashed border-base p-4">
            <button
              type="button"
              onClick={() => uploadRef.current?.click()}
              disabled={uploading}
              className="focus-ring flex min-h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-accent hover:bg-accent-soft"
            >
              <Plus size={16} weight="bold" />
              {uploading ? 'Adding pages…' : 'Add scanned pages (one or many images / PDFs)'}
            </button>
            <p className="muted mt-2 text-center text-[11px]">
              New pages join the composition in order and await review in the Digitization queue,
              like any page scan.
            </p>
          </div>
        )}

        {scans.length === 0 ? (
          <p className="muted text-sm">
            No scan pages yet — scan or add them above, or add page scans on the file page.
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
                    disabled={busy || !scan.hasDocument}
                    aria-label="Run OCR"
                    title="Run OCR (Hindi + English) and store the text for search"
                    onClick={() =>
                      run(async () => {
                        const result = await service.digitization.runOcr(scan.id);
                        if (result.ok) {
                          setOcr((current) => ({
                            ...current,
                            [scan.id]: { text: result.value.ocrText, method: result.value.method },
                          }));
                          await reload();
                        } else setError(result.error ?? 'OCR failed.');
                      })
                    }
                  >
                    <TextAa size={14} />
                  </Button>
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

                {(ocr[scan.id] || scan.ocrText) && (
                  <div className="mt-3 rounded-lg bg-[var(--rr-bg)] p-2.5">
                    <p className="muted text-[10px] uppercase tracking-wider">
                      OCR text{ocr[scan.id] ? ` · ${ocr[scan.id].method}` : ''}
                    </p>
                    <p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-5">
                      {ocr[scan.id]?.text || scan.ocrText}
                    </p>
                  </div>
                )}

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
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold">
            Deliverable PDFs <span className="muted">({derivatives.length})</span>
          </p>
          <p className="muted text-[11px]">
            Every build stays here for tracking. The newest <strong>Approved</strong> build is the
            file's deliverable.
          </p>
        </div>
        {derivatives.length === 0 ? (
          <p className="muted mt-3 text-sm">
            Nothing built yet. Approve pages in the review queue, then “Build deliverable PDF”.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--rr-border)]">
            {derivatives.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold">{item.filename}</p>
                    <Badge
                      tone={
                        item.status === 'Approved'
                          ? 'success'
                          : item.status === 'Rejected'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {item.status}
                    </Badge>
                  </div>
                  <p className="muted text-xs">
                    {item.pageCount} page(s) ·{' '}
                    {item.sizeBytes ? `${Math.max(1, Math.round(item.sizeBytes / 1024))} KB` : '—'}
                    {item.includesOcrText ? ' · searchable text layer' : ''}
                    {item.reviewedBy ? ` · reviewed by ${item.reviewedBy}` : ''}
                  </p>
                  {item.reviewNote && <p className="muted text-[11px]">Note: {item.reviewNote}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {canReview && item.status === 'Pending approval' && (
                    <>
                      <Button
                        size="sm"
                        icon={<CheckCircle size={15} />}
                        disabled={busy}
                        onClick={() => void reviewPdf(item, 'Approved')}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<XCircle size={15} />}
                        disabled={busy}
                        onClick={() => setRejectingPdf(item)}
                      >
                        Reject…
                      </Button>
                    </>
                  )}
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
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={rejectingPdf !== null}
        onClose={() => setRejectingPdf(null)}
        title={`Reject ${rejectingPdf?.filename ?? ''}`}
        description="The build stays in the history with your reason; fix the composition and build again."
      >
        {rejectingPdf && (
          <RejectPdfForm
            onSubmit={async (note) => {
              await reviewPdf(rejectingPdf, 'Rejected', note);
              setRejectingPdf(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function RejectPdfForm({ onSubmit }: { onSubmit: (note: string) => void }) {
  const [note, setNote] = useState('');

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(note);
      }}
    >
      <Field label="Reason" htmlFor="reject-pdf-note" required>
        <TextArea
          id="reject-pdf-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Wrong page order, two pages missing after page 4…"
        />
      </Field>
      <Button type="submit" disabled={!note.trim()}>
        Reject this build
      </Button>
    </form>
  );
}
