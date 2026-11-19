/**
 * Scan composition studio (work plan §3.4): the gallery that turns "stored
 * scans" into "digitized properly". Thumbnail grid with drag-to-reorder,
 * per-page rotate / enhance / compare / duplicate / revert, and the deliverable
 * PDF built from the approved pages (§3.5). The original scan is never
 * modified — enhancements write a processed copy server-side.
 *
 * Round 4: the studio is the digitization workbench. Pages can be scanned /
 * uploaded right here (one or many images or PDFs), and existing PDF versions
 * can be previewed, edited, and reordered. Every build, approved or not, stays
 * in the history for tracking.
 */
import { useCallback, useEffect, useRef, useState, lazy, Suspense, type ChangeEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowsInLineHorizontal,
  CheckCircle,
  Copy,
  DownloadSimple,
  Eye,
  FilePdf,
  FloppyDisk,
  MagnifyingGlass,
  PencilSimple,
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
import { extractPdfPagesToImages } from '../lib/pdf-unpack';
import type { DocumentDerivative, FileScan, RecordFileDocument } from '../types';

const PdfDocumentViewer = lazy(() =>
  import('../components/files/PdfDocumentViewer').then((module) => ({
    default: module.PdfDocumentViewer,
  })),
);

const ENHANCEMENTS = ['deskew', 'despeckle', 'binarize', 'crop', 'contrast'] as const;

export interface UnifiedDocumentVersion {
  id: string;
  source: 'document' | 'derivative';
  filename: string;
  versionLabel: string;
  updatedAt: string;
  pageCount?: number;
  sizeBytes?: number;
  status: 'Approved' | 'Pending approval' | 'Rejected';
  reviewNote?: string;
  reviewedBy?: string;
  rawDoc?: RecordFileDocument;
  rawDeriv?: DocumentDerivative;
}

export function ScanStudioPage({ embedded = false }: { embedded?: boolean }) {
  const { fileId } = useParams<{ fileId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { allowed } = useSession();
  const canUploadPages = allowed('digitization.upload');
  const canReview = allowed('digitization.review');

  const [scans, setScans] = useState<FileScan[]>([]);
  const [derivatives, setDerivatives] = useState<DocumentDerivative[]>([]);
  const [documents, setDocuments] = useState<RecordFileDocument[]>([]);
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
  const [previewingVersion, setPreviewingVersion] = useState<UnifiedDocumentVersion | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const dragId = useRef<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    if (!fileId) return;
    const [file, pages, pdfs, docs] = await Promise.all([
      service.files.get(fileId),
      service.digitization.list(fileId),
      service.digitization.listPdfs(fileId),
      service.files.listDocuments(fileId),
    ]);
    setFileNumber(file?.fileNumber ?? fileId);
    setScans(pages);
    setDerivatives(pdfs);
    setDocuments(docs);
    setOrderDirty(false);

    const urls: Record<string, string> = {};
    await Promise.all(
      pages
        .filter((page) => page.hasDocument)
        .map(async (page) => {
          try {
            let blob: Blob;
            if (page.hasProcessed) {
              try {
                blob = await service.digitization.scanBlob(page.id, 'processed');
              } catch {
                blob = await service.digitization.scanBlob(page.id, 'original');
              }
            } else {
              blob = await service.digitization.scanBlob(page.id, 'original');
            }

            if (blob.type === 'application/pdf' || page.filename.toLowerCase().endsWith('.pdf')) {
              try {
                const [firstPage] = await extractPdfPagesToImages(blob, page.filename);
                if (firstPage) {
                  urls[page.id] = URL.createObjectURL(firstPage);
                  return;
                }
              } catch {
                /* fallback to raw blob url */
              }
            }

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
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  // Clean up preview object url when active preview changes or unmounts
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Unified versions list, sorted by date descending (latest on top)
  const unifiedVersions: UnifiedDocumentVersion[] = [
    ...documents.map((doc): UnifiedDocumentVersion => ({
      id: doc.id,
      source: 'document',
      filename: doc.filename,
      versionLabel: `v${doc.version}`,
      updatedAt: doc.uploadedAt,
      pageCount: doc.pageCount,
      sizeBytes: doc.sizeBytes,
      status: 'Approved',
      rawDoc: doc,
    })),
    ...derivatives.map((deriv): UnifiedDocumentVersion => ({
      id: deriv.id,
      source: 'derivative',
      filename: deriv.filename,
      versionLabel: `Build #${deriv.id.replace(/\D/g, '') || deriv.id}`,
      updatedAt: deriv.createdAt,
      pageCount: deriv.pageCount,
      sizeBytes: deriv.sizeBytes,
      status: deriv.status,
      reviewNote: deriv.reviewNote,
      reviewedBy: deriv.reviewedBy,
      rawDeriv: deriv,
    })),
  ].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

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
   * Adds pages to the studio composition:
   * Supports both image files and multi-page PDFs (which are automatically unpacked into pages).
   */
  const addPages = async (files: File[]) => {
    if (files.length === 0 || !fileId) return;
    setUploading(true);
    setError('');
    try {
      let pageNo = scans.reduce((max, row) => Math.max(max, row.pageNo), 0);
      const failures: string[] = [];
      let totalPagesAdded = 0;

      for (const upload of files) {
        const isPdf =
          upload.type === 'application/pdf' || upload.name.toLowerCase().endsWith('.pdf');
        if (isPdf) {
          try {
            const extracted = await extractPdfPagesToImages(upload, upload.name);
            for (const pageFile of extracted) {
              pageNo += 1;
              const added = await service.digitization.add(fileId, {
                pageNo,
                filename: pageFile.name,
                documentSize: 'A4',
                note: `Extracted from ${upload.name}.`,
              });
              if (added.ok) {
                await service.digitization.addDocument(added.value.id, pageFile);
                totalPagesAdded += 1;
              } else {
                failures.push(`${pageFile.name}: ${added.error}`);
              }
            }
          } catch (e) {
            failures.push(
              `${upload.name}: ${e instanceof Error ? e.message : 'Could not extract PDF pages.'}`,
            );
          }
        } else {
          pageNo += 1;
          const added = await service.digitization.add(fileId, {
            pageNo,
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
          else totalPagesAdded += 1;
        }
      }

      await reload();
      if (failures.length > 0) setError(failures.join(' · '));
      if (totalPagesAdded > 0) {
        setMessage(
          `${totalPagesAdded} page(s) added to the studio. Drag to rearrange or click "Build deliverable PDF" when ready.`,
        );
      }
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  const onUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    void addPages(Array.from(event.target.files ?? []));
  };

  /**
   * Loads an existing PDF version into the studio grid by extracting its pages,
   * enabling basic editing (rearranging pages by drag-and-drop, adding new pages, etc.).
   */
  const unpackVersionIntoStudio = async (version: UnifiedDocumentVersion) => {
    if (!fileId) return;
    setBusy(true);
    setError('');
    setMessage(`Loading pages from ${version.filename} into the studio…`);
    try {
      const blob =
        version.source === 'document'
          ? await service.files.documentBlob(fileId, version.id)
          : await service.digitization.pdfBlob(version.id);

      const extracted = await extractPdfPagesToImages(blob, version.filename);
      let pageNo = scans.reduce((max, row) => Math.max(max, row.pageNo), 0);
      let count = 0;

      for (const pageFile of extracted) {
        pageNo += 1;
        const added = await service.digitization.add(fileId, {
          pageNo,
          filename: pageFile.name,
          documentSize: 'A4',
          note: `Imported from ${version.filename}`,
        });
        if (added.ok) {
          await service.digitization.addDocument(added.value.id, pageFile);
          count += 1;
        }
      }

      setMessage(
        `Loaded ${count} page(s) from ${version.filename}. You can now drag to rearrange, add more pages, or build a new version.`,
      );
      setPreviewingVersion(null);
      await reload();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not unpack pages from the selected document.',
      );
    } finally {
      setBusy(false);
    }
  };

  const openPreview = async (version: UnifiedDocumentVersion) => {
    if (!fileId) return;
    setBusy(true);
    setError('');
    try {
      const blob =
        version.source === 'document'
          ? await service.files.documentBlob(fileId, version.id)
          : await service.digitization.pdfBlob(version.id);

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setPreviewingVersion(version);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load PDF preview.');
    } finally {
      setBusy(false);
    }
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewingVersion(null);
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
      <input
        ref={uploadRef}
        type="file"
        multiple
        accept={documentAcceptAttribute()}
        onChange={onUploadChange}
        className="hidden"
        disabled={uploading}
      />

      {!embedded && (
        <>
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
            title="Edit in studio"
            description="Preview and edit existing PDFs or scan pages. Rearrange pages by drag-and-drop, add new scanned sheets, and build the deliverable PDF with full version history."
            actions={
              <>
                {canUploadPages && (
                  <Button
                    size="sm"
                    icon={<UploadSimple size={17} className="text-accent" />}
                    onClick={() => uploadRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? 'Adding…' : 'Scan / add pages'}
                  </Button>
                )}
                <Link className="text-xs underline" to={`/files/${fileId}`}>
                  Back to file
                </Link>
              </>
            }
          />
        </>
      )}

      {message && (
        <div className="rounded-xl border border-[var(--rr-success)]/30 bg-[var(--rr-success)]/10 p-3 text-xs font-medium text-[var(--rr-success)]">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-[var(--rr-danger)]/30 bg-[var(--rr-danger)]/10 p-3 text-xs font-medium text-[var(--rr-danger)]">
          {error}
        </div>
      )}

      {/* Two-column layout: Main editing / preview area on left, all versions on right */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Main Studio Area */}
        <div className="space-y-6">
          {previewingVersion && previewUrl ? (
            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-base pb-3">
                <div className="flex items-center gap-2">
                  <FilePdf size={20} className="text-accent" />
                  <div>
                    <p className="text-sm font-semibold">{previewingVersion.filename}</p>
                    <p className="muted text-xs">
                      {previewingVersion.versionLabel} ·{' '}
                      {new Date(previewingVersion.updatedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<PencilSimple size={15} />}
                    onClick={() => void unpackVersionIntoStudio(previewingVersion)}
                    disabled={busy}
                    title="Load all pages of this PDF into the studio grid for drag-and-drop reordering"
                  >
                    Edit pages in studio
                  </Button>
                  <Button size="sm" variant="ghost" onClick={closePreview}>
                    Close preview
                  </Button>
                </div>
              </div>

              <Suspense
                fallback={
                  <div className="grid h-[50vh] place-items-center text-sm muted">
                    Loading PDF reader…
                  </div>
                }
              >
                <PdfDocumentViewer
                  src={previewUrl}
                  filename={previewingVersion.filename}
                  heightClassName="h-[calc(100vh-18rem)] min-h-[480px]"
                />
              </Suspense>
            </Card>
          ) : (
            <Card>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">
                    Pages <span className="muted">({scans.length})</span>
                  </p>
                  <p className="muted mt-0.5 text-xs">
                    Drag and drop cards to rearrange page order.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canUploadPages && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Plus size={15} />}
                      onClick={() => uploadRef.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? 'Adding…' : 'Add pages'}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<FloppyDisk size={15} />}
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
                    size="sm"
                    icon={<FilePdf size={15} />}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await service.digitization.buildPdf(fileId ?? '');
                        if (result.ok) {
                          setMessage(
                            `${result.value.filename} built from approved pages — awaiting review approval.`,
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

              {canUploadPages && scans.length === 0 && (
                <div className="mb-4 rounded-xl border border-dashed border-base p-6 text-center">
                  <p className="text-sm font-semibold">No scan pages in the current workspace</p>
                  <p className="muted mt-1 text-xs">
                    Upload images or PDFs to start, or select any version from the right to edit its
                    pages.
                  </p>
                  <button
                    type="button"
                    onClick={() => uploadRef.current?.click()}
                    disabled={uploading}
                    className="focus-ring mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--rr-accent-fill)] px-4 text-xs font-semibold text-white hover:opacity-90"
                  >
                    <Plus size={15} weight="bold" />
                    {uploading ? 'Adding pages…' : 'Add scanned pages (Images or PDFs)'}
                  </button>
                </div>
              )}

              {scans.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {scans.map((scan, index) => (
                    <div
                      key={scan.id}
                      draggable
                      onDragStart={() => (dragId.current = scan.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (dragId.current && dragId.current !== scan.id)
                          move(dragId.current, scan.id);
                        dragId.current = null;
                      }}
                      className="group cursor-move rounded-xl border border-base bg-[var(--rr-bg)] p-3 transition hover:border-[var(--rr-accent)]"
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
                          <div className="flex flex-col items-center gap-1.5 p-3 text-center">
                            <FilePdf size={28} className="text-accent" />
                            <span className="muted text-xs font-semibold">Page {scan.pageNo}</span>
                            <span className="muted text-[10px] break-all">{scan.filename}</span>
                          </div>
                        )}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {scan.enhancement && <Badge tone="info">{scan.enhancement}</Badge>}
                        {scan.dpi && <Badge tone="neutral">{scan.dpi} DPI</Badge>}
                        <Badge tone="neutral">{scan.documentSize || 'A4'}</Badge>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          aria-label="Rotate left"
                          title="Rotate 90° left"
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
                          title="Rotate 90° right"
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
                          title="Run OCR and store text"
                          onClick={() =>
                            run(async () => {
                              const result = await service.digitization.runOcr(scan.id);
                              if (result.ok) {
                                setOcr((current) => ({
                                  ...current,
                                  [scan.id]: {
                                    text: result.value.ocrText,
                                    method: result.value.method,
                                  },
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
                          title="Compare with original"
                          onClick={() => setCompare(compare === scan.id ? null : scan.id)}
                        >
                          <ArrowsInLineHorizontal size={14} />
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          aria-label="Duplicate page"
                          title="Duplicate page"
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
                            title="Revert to original"
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
                          title="Delete page"
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
          )}
        </div>

        {/* Right Side Area: Document Versions list */}
        <div className="space-y-4">
          <Card>
            <div className="mb-3 flex items-center justify-between border-b border-base pb-3">
              <div>
                <p className="text-sm font-semibold">Document versions</p>
                <p className="muted mt-0.5 text-xs">
                  {unifiedVersions.length} version(s) · Latest on top
                </p>
              </div>
              <FilePdf size={20} className="text-accent" />
            </div>

            {unifiedVersions.length === 0 ? (
              <p className="muted py-4 text-center text-xs">No PDF versions registered yet.</p>
            ) : (
              <div className="space-y-3">
                {unifiedVersions.map((version, index) => {
                  const isCurrent = index === 0;
                  const isPending = version.status === 'Pending approval';
                  const isRejected = version.status === 'Rejected';

                  return (
                    <div
                      key={version.id}
                      className={`rounded-xl border p-3 transition ${
                        previewingVersion?.id === version.id
                          ? 'border-[var(--rr-accent)] bg-accent-soft/30'
                          : 'border-base bg-[var(--rr-surface)] hover:border-base'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-semibold text-xs">
                              {version.filename}
                            </span>
                          </div>
                          <p className="muted mt-1 text-[11px]">
                            {version.versionLabel} ·{' '}
                            {new Date(version.updatedAt).toLocaleDateString()} ·{' '}
                            {version.pageCount ? `${version.pageCount} page(s)` : ''}
                            {version.sizeBytes
                              ? ` · ${Math.max(1, Math.round(version.sizeBytes / 1024))} KB`
                              : ''}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {isCurrent && <Badge tone="success">Current version</Badge>}
                          <Badge
                            tone={
                              version.status === 'Approved'
                                ? 'success'
                                : isRejected
                                  ? 'danger'
                                  : 'warning'
                            }
                          >
                            {version.status}
                          </Badge>
                        </div>
                      </div>

                      {version.reviewNote && (
                        <p className="muted mt-1.5 rounded bg-[var(--rr-bg)] p-2 text-[10px]">
                          Note: {version.reviewNote}
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-base pt-2.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Eye size={13} />}
                          onClick={() => void openPreview(version)}
                          disabled={busy}
                          className="!h-7 !px-2 text-[11px]"
                          title="Preview this PDF in reader"
                        >
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<PencilSimple size={13} />}
                          onClick={() => void unpackVersionIntoStudio(version)}
                          disabled={busy}
                          className="!h-7 !px-2 text-[11px]"
                          title="Edit and rearrange pages of this PDF"
                        >
                          Edit in studio
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<DownloadSimple size={13} />}
                          className="!h-7 !px-2 text-[11px]"
                          title="Download PDF"
                          onClick={async () => {
                            const blob =
                              version.source === 'document'
                                ? await service.files.documentBlob(fileId!, version.id)
                                : await service.digitization.pdfBlob(version.id);
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = version.filename;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                        >
                          Download
                        </Button>
                        {canReview && version.rawDeriv && isPending && (
                          <>
                            <button
                              type="button"
                              onClick={() => void reviewPdf(version.rawDeriv!, 'Approved')}
                              className="focus-ring ml-auto inline-flex h-7 items-center gap-1 rounded-md bg-[var(--rr-success)] px-2 text-[11px] font-semibold text-white"
                            >
                              <CheckCircle size={12} /> Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => setRejectingPdf(version.rawDeriv!)}
                              className="focus-ring inline-flex h-7 items-center gap-1 rounded-md bg-[var(--rr-danger)]/10 px-2 text-[11px] font-semibold text-[var(--rr-danger)] hover:bg-[var(--rr-danger)]/20"
                            >
                              <XCircle size={12} /> Reject
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>

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
