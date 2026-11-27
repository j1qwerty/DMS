/**
 * Scan composition studio (work plan §3.4), redesigned: a clean page grid
 * where cards show only the preview and a status dot — click a card for the
 * full-screen preview, where every action (rotate, enhance, OCR, compare,
 * duplicate, delete) lives. Reordering is an explicit mode behind the
 * "Reorder" button: drag-and-drop is only on then, so a click never has to
 * guess between "open" and "drag". Page-extraction and OCR of new uploads run
 * as a background queue (the API OCRs in the background too), so the grid
 * stays usable while pages land.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowsDownUp,
  ArrowsInLineHorizontal,
  ArrowsOut,
  CheckCircle,
  Copy,
  DownloadSimple,
  FilePdf,
  FloppyDisk,
  PencilSimple,
  Plus,
  Spinner,
  TextAa,
  Trash,
  X,
  XCircle,
} from '@phosphor-icons/react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Field, TextArea, TextInput } from '../components/ui/Field';
import { StatusBadge } from '../components/ui/Flash';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { PageImageViewer } from '../components/files/PageImageViewer';
import { service } from '../services';
import { useFlash, useSession } from '../hooks/useService';
import { isTyping, usePageKeys } from '../hooks/usePageKeys';
import { realtime } from '../services/realtime';
import { documentAcceptAttribute } from '../lib/document';
import { extractPdfPagesToImages } from '../lib/pdf-unpack';
import { cn } from '../lib/utils';
import type { DocumentDerivative, FileScan, RecordFileDocument } from '../types';
import {
  type StudioDraftState,
  type UnifiedDocumentVersion,
  getStudioDraft,
  setStudioDraft,
  computeNextVersionName,
  documentVersionKey,
} from '../lib/studioDraft';

const ENHANCEMENTS = ['deskew', 'despeckle', 'binarize', 'crop', 'contrast'] as const;

const STATUS_DOT: Record<string, string> = {
  Processing: 'bg-amber-400 animate-pulse',
  'Pending review': 'bg-amber-500',
  Approved: 'bg-emerald-500',
  Rejected: 'bg-rose-500',
  Duplicate: 'bg-slate-400',
  Active: 'bg-emerald-500',
};

export function ScanStudioPage() {
  const { fileId } = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { allowed } = useSession();
  const { success, danger } = useFlash();
  const canUploadPages = allowed('digitization.upload');
  const canReview = allowed('digitization.review');

  const [scans, setScans] = useState<FileScan[]>([]);
  const [derivatives, setDerivatives] = useState<DocumentDerivative[]>([]);
  const [documents, setDocuments] = useState<RecordFileDocument[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [fileNumber, setFileNumber] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Uploads run as a background queue: the grid stays interactive and pages
  // appear as they are added; the chip in the toolbar is the only progress UI.
  const [queue, setQueue] = useState<{ done: number; total: number; label: string } | null>(null);
  const queueBusy = useRef(false);

  const [reorderMode, setReorderMode] = useState(false);
  const [orderDirty, setOrderDirty] = useState(false);

  // The full-screen preview a card click opens.
  const lightboxId = params.get('page');
  const setLightboxId = useCallback(
    (id: string | null) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (id) next.set('page', id);
          else next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const [showOcr, setShowOcr] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [compareUrl, setCompareUrl] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<FileScan | null>(null);
  const [confirmUnpack, setConfirmUnpack] = useState<UnifiedDocumentVersion | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [rejectingPdf, setRejectingPdf] = useState<DocumentDerivative | null>(null);
  const [buildingPdf, setBuildingPdf] = useState(false);

  const [draft, setDraft] = useState<StudioDraftState | null>(() =>
    fileId ? getStudioDraft(fileId) : null,
  );

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
        .slice(0, 240)
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
                /* fall back to the raw blob url */
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

  // While the API's background OCR pass is running on any page, refresh the
  // grid so the status dots flip to their final colour on their own.
  const hasProcessing =
    scans.some((scan) => scan.status === 'Processing') ||
    documents.some((document) => document.studioImportPending);
  useEffect(() => {
    void realtime.join(['digitization']);
    return realtime.subscribe((notification) => {
      if (notification.action === 'document.ocr.processed') void reload();
    });
  }, [reload]);
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = window.setInterval(() => void reload(), 3000);
    return () => window.clearInterval(timer);
  }, [hasProcessing, reload]);

  // Revoke the compare blob url when the lightbox closes.
  useEffect(() => {
    if (compareUrl && lightboxId === null) {
      URL.revokeObjectURL(compareUrl);
      queueMicrotask(() => setCompareUrl(null));
    }
  }, [compareUrl, lightboxId]);

  const baseSource =
    draft?.sourceFilename ||
    documents[0]?.filename ||
    derivatives[0]?.filename ||
    `${fileNumber || fileId}.pdf`;
  const defaultBuildName =
    draft?.draftFilename || computeNextVersionName(baseSource, derivatives, documents);

  const touchDraft = (pageCount: number) => {
    if (!fileId) return;
    const updated: StudioDraftState = {
      sourceVersionId: draft?.sourceVersionId,
      sourceFilename: baseSource,
      draftFilename:
        draft?.draftFilename || computeNextVersionName(baseSource, derivatives, documents),
      pageCount,
      updatedAt: new Date().toISOString(),
    };
    setDraft(updated);
    setStudioDraft(fileId, updated);
  };

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
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The operation failed.');
    }
    setBusy(false);
  };

  /**
   * Upload images as individual scans and PDFs as stored versions. The backend
   * processes PDF pages and OCR after the upload returns.
   */
  const addPages = async (files: File[]) => {
    if (files.length === 0 || !fileId || queueBusy.current) return;
    queueBusy.current = true;
    setQueue({ done: 0, total: files.length, label: files[0]?.name ?? '' });
    try {
      let pageNo = scans.reduce((max, row) => Math.max(max, row.pageNo), 0);
      const failures: string[] = [];
      let added = 0;
      let queuedPdfs = 0;

      for (const [index, upload] of files.entries()) {
        setQueue({ done: index, total: files.length, label: upload.name });
        const isPdf =
          upload.type === 'application/pdf' || upload.name.toLowerCase().endsWith('.pdf');
        if (isPdf) {
          const result = await service.files.uploadDocument(fileId, upload, true);
          if (result.ok) queuedPdfs += 1;
          else failures.push(`${upload.name}: ${result.error}`);
        } else {
          pageNo += 1;
          const meta = await service.digitization.add(fileId, {
            pageNo,
            filename: upload.name,
            documentSize: '',
            note: 'Uploaded in the scan studio.',
          });
          if (!meta.ok) {
            failures.push(`${upload.name}: ${meta.error}`);
            continue;
          }
          const withDoc = await service.digitization.addDocument(meta.value.id, upload);
          if (withDoc.ok) added += 1;
          else failures.push(`${upload.name}: ${withDoc.error}`);
        }

        // Progressive refresh: every second file the grid picks up what has
        // landed so far; a final reload runs after the loop.
        if (index % 2 === 1) await reload();
      }

      await reload();
      if (failures.length > 0) setError(failures.slice(0, 4).join(' · '));
      if (queuedPdfs > 0) {
        success(`${queuedPdfs} PDF(s) uploaded. Studio pages and OCR are processing.`);
      }
      if (added > 0) {
        touchDraft(scans.length + added);
        success(`${added} page(s) added — text extraction and OCR finish in the background.`);
      }
    } finally {
      queueBusy.current = false;
      setQueue(null);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  const onUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    void addPages(Array.from(event.target.files ?? []));
  };

  /** Loads an existing PDF version into the studio grid by extracting its pages. */
  const unpackVersionIntoStudio = async (version: UnifiedDocumentVersion) => {
    if (!fileId) return;
    setConfirmUnpack(null);

    if (draft?.sourceVersionId === documentVersionKey(version) && scans.length > 0) {
      success(`Pages from ${version.filename} are already open in the studio grid.`);
      return;
    }

    setBusy(true);
    setError('');
    try {
      const blob =
        version.source === 'document'
          ? await service.files.documentBlob(fileId, version.id)
          : await service.digitization.pdfBlob(version.id);

      const extracted = await extractPdfPagesToImages(blob, version.filename);
      if (extracted.length === 0) throw new Error('This document has no pages to import.');
      // Clear the previous working pages so the new version's pages do not
      // append to a stale workspace.
      for (const scan of scans) {
        await service.digitization.remove(scan.id);
      }

      let pageNo = 0;
      let count = 0;
      for (const pageFile of extracted) {
        pageNo += 1;
        const meta = await service.digitization.add(fileId, {
          pageNo,
          filename: pageFile.name,
          documentSize: 'A4',
          note: `Imported from ${version.filename}`,
        });
        if (meta.ok) {
          await service.digitization.addDocument(meta.value.id, pageFile);
          count += 1;
        }
      }

      const nextName = computeNextVersionName(version.filename, derivatives, documents);
      const newDraft: StudioDraftState = {
        sourceVersionId: documentVersionKey(version),
        sourceFilename: version.filename,
        draftFilename: nextName,
        pageCount: count,
        updatedAt: new Date().toISOString(),
      };
      setDraft(newDraft);
      setStudioDraft(fileId, newDraft);
      success(`Loaded ${count} page(s) from ${version.filename} into the workspace.`);
      await reload();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not unpack pages from the selected document.',
      );
    } finally {
      setBusy(false);
    }
  };

  const executeBuildPdf = async (name: string, remarks: string) => {
    if (!fileId) return;
    setBusy(true);
    setError('');
    try {
      const result = await service.digitization.buildPdf(fileId, name.trim(), remarks.trim());
      if (result.ok) {
        setBuildingPdf(false);
        setStudioDraft(fileId, null);
        setDraft(null);
        setOrderDirty(false);
        success(`${result.value.filename} built (${result.value.status.toLowerCase()}).`);
        await reload();
      } else {
        setError(result.error ?? 'The PDF could not be built.');
      }
    } finally {
      setBusy(false);
    }
  };

  const reviewPdf = async (
    item: DocumentDerivative,
    decision: 'Approved' | 'Rejected',
    note = '',
  ) => {
    await run(async () => {
      const result = await service.digitization.reviewPdf(item.id, decision, note, fileId);
      if (result.ok) {
        success(`${item.filename} ${decision.toLowerCase()}.`);
        await reload();
      } else setError(result.error ?? 'The review could not be saved.');
    });
  };

  // ---------------------------------------------------------------- lightbox
  const lightboxIndex = lightboxId ? scans.findIndex((scan) => scan.id === lightboxId) : -1;
  const lightboxScan = lightboxIndex >= 0 ? scans[lightboxIndex] : null;
  const openLightbox = (scan: FileScan) => {
    if (reorderMode) return;
    setLightboxId(scan.id);
    setShowOcr(false);
  };
  const stepLightbox = useCallback(
    (delta: number) => {
      const next = scans[lightboxIndex + delta];
      if (next) setLightboxId(next.id);
    },
    [lightboxIndex, scans, setLightboxId],
  );

  const patch = (scanId: string, updater: (page: FileScan) => FileScan) =>
    setScans((rows) => rows.map((row) => (row.id === scanId ? updater(row) : row)));

  usePageKeys(stepLightbox, lightboxScan !== null && scans.length > 1);

  useEffect(() => {
    if (!lightboxScan) return;
    const onEscape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !isTyping(event.target) &&
        !document.querySelector('[aria-modal="true"]')
      ) {
        setLightboxId(null);
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [lightboxScan, setLightboxId]);

  const lightboxRotate = async (degrees: 90 | 270) => {
    if (!lightboxScan) return;
    const result = await service.digitization.rotate(lightboxScan.id, degrees);
    if (result.ok) {
      patch(lightboxScan.id, () => result.value);
      await reload();
    } else danger(result.error ?? 'Rotation failed.');
  };

  const lightboxEnhance = async (operation: string) => {
    if (!lightboxScan) return;
    const result = await service.digitization.enhance(lightboxScan.id, operation);
    if (result.ok) {
      patch(lightboxScan.id, () => result.value);
      await reload();
    } else danger(result.error ?? 'Enhancement failed.');
  };

  const lightboxOcr = async () => {
    if (!lightboxScan) return;
    setOcrBusy(true);
    try {
      const result = await service.digitization.runOcr(lightboxScan.id);
      if (result.ok) {
        patch(lightboxScan.id, (page) => ({ ...page, ocrText: result.value.ocrText }));
        success(
          result.value.ocrText.trim()
            ? `OCR finished (${result.value.method}).`
            : `OCR ran (${result.value.method}) but found no text — try enhancing the page first.`,
        );
      } else danger(result.error ?? 'OCR failed.');
    } finally {
      setOcrBusy(false);
    }
  };

  const lightboxCompare = async () => {
    if (!lightboxScan) return;
    if (compareUrl) {
      URL.revokeObjectURL(compareUrl);
      setCompareUrl(null);
    }
    try {
      const blob = await service.digitization.scanBlob(lightboxScan.id, 'original');
      setCompareUrl(URL.createObjectURL(blob));
    } catch {
      danger('The original scan could not be loaded.');
    }
  };

  const lightboxDuplicate = async () => {
    if (!lightboxScan) return;
    const result = await service.digitization.duplicate(lightboxScan.id);
    if (result.ok) {
      success('Page duplicated.');
      await reload();
    } else danger(result.error ?? 'Duplicate failed.');
  };

  const lightboxRevert = async () => {
    if (!lightboxScan) return;
    const result = await service.digitization.revert(lightboxScan.id);
    if (result.ok) {
      patch(lightboxScan.id, () => result.value);
      await reload();
    } else danger(result.error ?? 'Revert failed.');
  };

  const deletePage = async () => {
    if (!deleteTarget) return;
    const result = await service.digitization.remove(deleteTarget.id);
    setDeleteTarget(null);
    if (result.ok) {
      if (lightboxId === deleteTarget.id) setLightboxId(null);
      success('Page removed from the workspace.');
      await reload();
    } else danger(result.error ?? 'Delete failed.');
  };

  const discardDraft = async () => {
    setConfirmDiscard(false);
    if (!fileId) return;
    setBusy(true);
    try {
      for (const scan of scans) {
        await service.digitization.remove(scan.id);
      }
      setStudioDraft(fileId, null);
      setDraft(null);
      setOrderDirty(false);
      await reload();
      success('Studio workspace reset.');
    } finally {
      setBusy(false);
    }
  };

  // ----------------------------------------------------------------- reorder
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

  const saveOrder = () =>
    run(async () => {
      const result = await service.digitization.reorder(
        fileId ?? '',
        scans.map((row) => row.id),
      );
      if (result.ok) {
        setScans(result.value);
        setOrderDirty(false);
        touchDraft(result.value.length);
        success('Page order saved.');
      } else setError(result.error ?? 'The order could not be saved.');
    });

  return (
    <div className="space-y-5">
      <input
        ref={uploadRef}
        type="file"
        multiple
        accept={documentAcceptAttribute()}
        onChange={onUploadChange}
        className="hidden"
      />

      {error && (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--rr-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--rr-danger)_8%,transparent)] p-3 text-xs font-medium text-[var(--rr-danger)]">
          {error}
        </div>
      )}

      {!lightboxId && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* ------------------------------------------------ main studio area */}
          <div className="space-y-4">
            {/* Toolbar: workspace state on the left, the three actions on the right. */}
            <div className="flex flex-col gap-3 rounded-xl border border-base bg-[var(--rr-surface)] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  Workspace
                  <span className="muted font-normal">{scans.length} page(s)</span>
                  {draft && <Badge tone="warning">draft · {draft.draftFilename}</Badge>}
                </p>
                <p className="muted mt-0.5 text-xs">
                  {reorderMode
                    ? 'Drag the cards into the right order, then save.'
                    : 'Click a page to open it large; hover a card for the expand icon.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canUploadPages && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Plus size={15} />}
                    onClick={() => uploadRef.current?.click()}
                    disabled={queue !== null}
                  >
                    Add pages
                  </Button>
                )}
                {scans.length > 1 && (
                  <Button
                    size="sm"
                    variant={reorderMode ? 'primary' : 'secondary'}
                    icon={<ArrowsDownUp size={15} />}
                    onClick={() => {
                      setReorderMode((on) => !on);
                      if (reorderMode && orderDirty) setOrderDirty(false);
                      if (!reorderMode) setLightboxId(null);
                      // Leaving reorder with unsaved moves restores stored order.
                      if (reorderMode) void reload();
                    }}
                    className={cn(reorderMode && 'shadow-sm')}
                    title="Toggle drag-and-drop reordering"
                  >
                    {reorderMode ? 'Done reordering' : 'Reorder'}
                  </Button>
                )}
                {reorderMode && (
                  <Button
                    size="sm"
                    icon={<FloppyDisk size={15} />}
                    disabled={!orderDirty || busy}
                    onClick={saveOrder}
                  >
                    Save order
                  </Button>
                )}
                <Button
                  size="sm"
                  icon={<FilePdf size={15} />}
                  disabled={busy || queue !== null || scans.length === 0}
                  onClick={() => setBuildingPdf(true)}
                  title="Build a deliverable PDF from the workspace pages"
                >
                  Build PDF
                </Button>
              </div>
            </div>

            {/* Background queue chip: upload progress only — extraction and OCR
              continue in the background without blocking the grid. */}
            {queue && (
              <div className="flex items-center gap-3 rounded-xl border border-base bg-[var(--rr-bg)] p-3">
                <Spinner size={16} className="animate-spin text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">
                    Adding pages — {queue.done + 1} of {queue.total}
                    <span className="muted font-normal"> · {queue.label}</span>
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--rr-surface-2)]">
                    <div
                      className="h-full rounded-full bg-[var(--rr-accent)] transition-all"
                      style={{ width: `${Math.round((queue.done / queue.total) * 100)}%` }}
                    />
                  </div>
                </div>
                <span className="muted text-[11px]">runs in the background</span>
              </div>
            )}

            {hasProcessing && !queue && (
              <div className="flex items-center gap-2.5 rounded-xl border border-base bg-[var(--rr-bg)] p-3 text-xs">
                <Spinner size={15} className="animate-spin text-amber-500" />
                <p className="font-medium">
                  {scans.filter((scan) => scan.status === 'Processing').length} page(s) are being
                  OCR-processed in the background — their text arrives here on its own.
                </p>
              </div>
            )}

            <Card>
              {scans.length === 0 ? (
                <div className="rounded-xl border border-dashed border-base p-8 text-center">
                  <FilePdf size={28} className="mx-auto text-accent" />
                  <p className="mt-3 text-sm font-semibold">No pages in the workspace</p>
                  <p className="muted mx-auto mt-1 max-w-md text-xs leading-5">
                    Add images or multi-page PDFs — a PDF is unpacked into pages automatically, and
                    every page's OCR runs in the background. Or load any stored version from the
                    right to edit its pages.
                  </p>
                  {canUploadPages && (
                    <Button
                      size="sm"
                      className="mt-4"
                      icon={<Plus size={15} />}
                      onClick={() => uploadRef.current?.click()}
                      disabled={queue !== null}
                    >
                      Add scanned pages
                    </Button>
                  )}
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {scans.map((scan, index) => (
                    <div
                      key={scan.id}
                      draggable={reorderMode}
                      onDragStart={() => (dragId.current = scan.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (reorderMode && dragId.current && dragId.current !== scan.id)
                          move(dragId.current, scan.id);
                        dragId.current = null;
                      }}
                      className={cn(
                        'group relative overflow-hidden rounded-xl border bg-[var(--rr-bg)] transition',
                        reorderMode
                          ? 'cursor-grab border-base active:cursor-grabbing hover:border-[var(--rr-accent)]'
                          : 'cursor-pointer border-base hover:border-[var(--rr-accent)] hover:shadow-md',
                      )}
                      onClick={() => openLightbox(scan)}
                    >
                      <div className="grid aspect-[3/4] place-items-center overflow-hidden bg-[var(--rr-surface-2)]">
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
                            <FilePdf size={26} className="text-accent" />
                            <span className="muted text-xs font-semibold">Page {scan.pageNo}</span>
                            <span className="muted break-all text-[10px]">{scan.filename}</span>
                          </div>
                        )}
                      </div>

                      {/* Number + status — glanceable without opening anything. */}
                      <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-[var(--rr-surface)]/90 px-1.5 py-0.5 text-[11px] font-bold backdrop-blur">
                        {reorderMode ? `#${index + 1}` : `Page ${scan.pageNo}`}
                      </div>
                      <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 rounded-md bg-[var(--rr-surface)]/90 px-1.5 py-0.5 backdrop-blur">
                        <span
                          className={cn(
                            'size-2 rounded-full',
                            STATUS_DOT[scan.status] ?? 'bg-slate-400',
                          )}
                          title={scan.status}
                        />
                        <span className="muted text-[10px] font-semibold">
                          {scan.status === 'Processing' ? 'OCR…' : `v${scan.version}`}
                        </span>
                      </div>

                      {/* Hover: the expand icon — the one affordance on the card. */}
                      {!reorderMode && (
                        <div className="absolute inset-0 hidden items-center justify-center bg-slate-950/0 transition group-hover:bg-slate-950/10 sm:flex">
                          <span className="grid size-11 translate-y-2 place-items-center rounded-full bg-[var(--rr-surface)] text-[var(--rr-text)] opacity-0 shadow-lg transition group-hover:translate-y-0 group-hover:opacity-100">
                            <ArrowsOut size={19} />
                          </span>
                        </div>
                      )}

                      {reorderMode && (
                        <div className="absolute bottom-2 right-2 rounded-md bg-[var(--rr-surface)]/90 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--rr-muted)] backdrop-blur">
                          drag to reorder
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* ------------------------------------------------- versions sidebar */}
          <div className="space-y-4">
            <Card>
              <div className="mb-3 flex items-center justify-between border-b border-base pb-3">
                <div>
                  <p className="text-sm font-semibold">Document versions</p>
                  <p className="muted mt-0.5 text-xs">
                    {unifiedVersions.length} version(s) · latest on top
                  </p>
                </div>
                <FilePdf size={20} className="text-accent" />
              </div>

              {Boolean(draft) && (
                <div className="mb-3 rounded-xl border-2 border-dashed border-amber-400 bg-amber-50/60 p-3 dark:border-amber-600/50 dark:bg-amber-950/20">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-amber-900 dark:text-amber-200">
                        {draft?.draftFilename ?? defaultBuildName}
                      </span>
                      <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300">
                        Studio workspace · {scans.length} page(s)
                        {orderDirty ? ' · unsaved order' : ''}
                      </p>
                    </div>
                    <Badge tone="warning">Unsaved draft</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-amber-200/60 pt-2.5 dark:border-amber-800/60">
                    <Button
                      size="sm"
                      icon={<FilePdf size={13} />}
                      onClick={() => setBuildingPdf(true)}
                      disabled={busy || scans.length === 0}
                      className="!h-7 !px-2 text-[11px]"
                    >
                      Build deliverable PDF
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDiscard(true)}
                      disabled={busy}
                      className="!h-7 !px-2 text-[11px] text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/50"
                    >
                      Discard draft
                    </Button>
                  </div>
                </div>
              )}

              {unifiedVersions.length === 0 && scans.length === 0 && !draft ? (
                <p className="muted py-4 text-center text-xs">No PDF versions registered yet.</p>
              ) : (
                <div className="space-y-3">
                  {unifiedVersions.map((version, index) => {
                    const isCurrent = index === 0;
                    const isPending = version.status === 'Pending approval';
                    return (
                      <div
                        key={documentVersionKey(version)}
                        className={cn(
                          'rounded-xl border p-3 transition',
                          params.get('source') === documentVersionKey(version)
                            ? 'border-[var(--rr-accent)] bg-accent-soft/30'
                            : 'border-base bg-[var(--rr-surface)]',
                        )}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold">
                              {version.filename}
                            </span>
                            <p className="muted mt-1 text-[11px]">
                              {version.versionLabel} ·{' '}
                              {new Date(version.updatedAt).toLocaleDateString()}
                              {version.pageCount ? ` · ${version.pageCount} page(s)` : ''}
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
                                  : version.status === 'Rejected'
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
                            onClick={() =>
                              navigate(
                                `/files/${fileId}/preview?v=${encodeURIComponent(documentVersionKey(version))}&from=studio`,
                              )
                            }
                            disabled={busy}
                            className="!h-7 !px-2 text-[11px]"
                          >
                            Preview
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<PencilSimple size={13} />}
                            onClick={() => {
                              if (
                                scans.length > 0 &&
                                draft?.sourceVersionId !== documentVersionKey(version)
                              )
                                setConfirmUnpack(version);
                              else void unpackVersionIntoStudio(version);
                            }}
                            disabled={busy}
                            className="!h-7 !px-2 text-[11px]"
                            title="Load this PDF's pages into the studio grid"
                          >
                            Edit in studio
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<DownloadSimple size={13} />}
                            className="!h-7 !px-2 text-[11px]"
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
                                className="focus-ring inline-flex h-7 items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--rr-danger)_10%,transparent)] px-2 text-[11px] font-semibold text-[var(--rr-danger)]"
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
      )}
      {lightboxId && !lightboxScan && (
        <Button size="sm" variant="secondary" onClick={() => setLightboxId(null)}>
          Back to Studio
        </Button>
      )}

      {/* ------------------------------------------------ dedicated full-page preview */}
      {lightboxScan && (
        <div className="flex min-h-[calc(100dvh-15rem)] flex-col overflow-hidden rounded-xl bg-slate-950 text-white">
          {/* Header bar: back to grid + page identity + pager + close */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-950/95 px-4 py-2.5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setLightboxId(null)}
                className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
                title="Return to studio grid (Esc)"
              >
                ← Back to Studio
              </button>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                  <span className="truncate max-w-xs">{lightboxScan.filename}</span>
                  <StatusBadge status={lightboxScan.status} />
                  {lightboxScan.enhancement && (
                    <Badge tone="info">{lightboxScan.enhancement}</Badge>
                  )}
                </p>
                <p className="muted text-[11px] text-white/60">
                  Page {lightboxScan.pageNo} · v{lightboxScan.version} · position{' '}
                  {lightboxIndex + 1} of {scans.length}
                  {lightboxScan.dpi ? ` · ${lightboxScan.dpi} DPI` : ''}
                </p>
              </div>
            </div>

            {/* Center page stepper */}
            <div className="flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 p-1">
              <button
                type="button"
                onClick={() => stepLightbox(-1)}
                disabled={lightboxIndex <= 0}
                className="focus-ring grid size-7 place-items-center rounded text-white hover:bg-white/15 disabled:opacity-30"
                title="Previous page (Left arrow)"
                aria-label="Previous page"
              >
                <ArrowLeft size={14} />
              </button>
              <span className="min-w-24 text-center text-xs font-semibold">
                Page {lightboxIndex + 1} of {scans.length}
              </span>
              <button
                type="button"
                onClick={() => stepLightbox(1)}
                disabled={lightboxIndex >= scans.length - 1}
                className="focus-ring grid size-7 place-items-center rounded text-white hover:bg-white/15 disabled:opacity-30"
                title="Next page (Right arrow)"
                aria-label="Next page"
              >
                <ArrowRight size={14} />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setLightboxId(null)}
              className="focus-ring grid size-9 place-items-center rounded-lg hover:bg-white/10"
              aria-label="Close preview (Esc)"
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body: page canvas + optional OCR panel */}
          <div className="flex min-h-[55dvh] flex-1 overflow-hidden">
            {/* The page image canvas with zoom & fit controls */}
            <div className="relative flex min-w-0 flex-1 items-stretch">
              {previews[lightboxScan.id] ? (
                <PageImageViewer
                  src={previews[lightboxScan.id]}
                  alt={`Page ${lightboxScan.pageNo}`}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center bg-slate-900 p-8 text-center">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <FilePdf size={36} className="text-accent" />
                    <p className="text-xs text-white/70">No preview for this page</p>
                  </div>
                </div>
              )}
            </div>

            {/* OCR on demand — only when asked for */}
            {showOcr && (
              <div className="hidden w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-base bg-[var(--rr-surface)] text-[var(--rr-text)] lg:flex">
                <div className="flex items-center justify-between border-b border-base px-3 py-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    <TextAa size={13} className="text-accent" /> OCR text
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowOcr(false)}
                    className="focus-ring muted rounded p-1 hover:text-[var(--rr-text)]"
                    aria-label="Hide OCR"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  {lightboxScan.ocrText?.trim() ? (
                    <p className="whitespace-pre-wrap break-words font-mono text-[12px] leading-6">
                      {lightboxScan.ocrText}
                    </p>
                  ) : (
                    <p className="muted py-6 text-center text-xs leading-5">
                      No OCR text yet.
                      {lightboxScan.status === 'Processing'
                        ? ' The background pass is running — it will appear on its own.'
                        : ' Run recognition from the action bar.'}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* original-vs-processed compare */}
            {compareUrl && (
              <div className="hidden w-80 shrink-0 flex-col overflow-hidden rounded-xl bg-[var(--rr-surface)] xl:flex">
                <div className="flex items-center justify-between border-b border-base px-3 py-2">
                  <p className="text-xs font-semibold">Compare</p>
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(compareUrl);
                      setCompareUrl(null);
                    }}
                    className="focus-ring muted rounded p-1 hover:text-[var(--rr-text)]"
                    aria-label="Close compare"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="grid flex-1 grid-cols-2 gap-2 overflow-hidden p-2">
                  <div className="flex min-h-0 flex-col">
                    <p className="muted mb-1 text-center text-[10px] font-semibold">Original</p>
                    <div className="grid min-h-0 flex-1 place-items-center overflow-hidden rounded-lg bg-[var(--rr-surface-2)]">
                      <img
                        src={compareUrl}
                        alt="Original scan"
                        className="max-h-full object-contain"
                      />
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-col">
                    <p className="muted mb-1 text-center text-[10px] font-semibold">Processed</p>
                    <div className="grid min-h-0 flex-1 place-items-center overflow-hidden rounded-lg bg-[var(--rr-surface-2)]">
                      {previews[lightboxScan.id] ? (
                        <img
                          src={previews[lightboxScan.id]}
                          alt="Processed copy"
                          className="max-h-full object-contain"
                        />
                      ) : (
                        <span className="muted text-[10px]">no processed copy</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* action bar — every per-page action lives here, off the cards */}
          <div className="flex flex-wrap items-center justify-center gap-2 rounded-t-xl bg-slate-950/95 p-3">
            <button
              type="button"
              onClick={() => void lightboxRotate(270)}
              disabled={busy}
              className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-40"
              title="Rotate 90° left"
            >
              <ArrowCounterClockwise size={15} />
            </button>
            <button
              type="button"
              onClick={() => void lightboxRotate(90)}
              disabled={busy}
              className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-40"
              title="Rotate 90° right"
            >
              <ArrowClockwise size={15} />
            </button>
            <select
              className="h-9 rounded-lg border border-white/20 bg-white/10 px-2 text-xs font-semibold text-white outline-none"
              defaultValue=""
              disabled={busy}
              aria-label="Enhance page"
              onChange={(event) => {
                const operation = event.target.value;
                event.target.value = '';
                if (operation) void lightboxEnhance(operation);
              }}
            >
              <option value="" className="text-[var(--rr-text)]">
                Enhance…
              </option>
              {ENHANCEMENTS.map((operation) => (
                <option key={operation} value={operation} className="text-[var(--rr-text)]">
                  {operation}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowOcr((open) => !open)}
              className={cn(
                'focus-ring inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition',
                showOcr
                  ? 'bg-[var(--rr-accent-fill)] text-white'
                  : 'bg-white/10 text-white hover:bg-white/20',
              )}
              aria-pressed={showOcr}
            >
              <TextAa size={15} /> OCR text
            </button>
            <button
              type="button"
              onClick={() => void lightboxOcr()}
              disabled={ocrBusy || !lightboxScan.hasDocument}
              className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-40"
              title="Run OCR on this page"
            >
              {ocrBusy ? <Spinner size={15} className="animate-spin" /> : <TextAa size={15} />}
              Re-run OCR
            </button>
            {lightboxScan.hasProcessed && (
              <>
                <button
                  type="button"
                  onClick={() => void lightboxCompare()}
                  className={cn(
                    'focus-ring inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition',
                    compareUrl
                      ? 'bg-[var(--rr-accent-fill)] text-white'
                      : 'bg-white/10 text-white hover:bg-white/20',
                  )}
                  title="Compare the processed copy with the original"
                >
                  <ArrowsInLineHorizontal size={15} /> Compare
                </button>
                <button
                  type="button"
                  onClick={() => void lightboxRevert()}
                  disabled={busy}
                  className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-40"
                  title="Drop the processed copy, serve the original again"
                >
                  Original
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => void lightboxDuplicate()}
              disabled={busy}
              className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-40"
              title="Duplicate this page"
            >
              <Copy size={15} />
            </button>
            <button
              type="button"
              onClick={() => setDeleteTarget(lightboxScan)}
              className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--rr-danger)_25%,transparent)] px-3 py-2 text-xs font-semibold text-white hover:bg-[color-mix(in_srgb,var(--rr-danger)_45%,transparent)]"
              title="Delete this page"
            >
              <Trash size={15} />
            </button>
          </div>
        </div>
      )}

      <Modal
        open={buildingPdf}
        onClose={() => setBuildingPdf(false)}
        title="Save as Deliverable PDF"
        description={`Compile a deliverable PDF from the ${scans.length} page(s) currently organized in the scan studio.`}
      >
        {buildingPdf && (
          <BuildDeliverablePdfForm
            defaultName={defaultBuildName}
            busy={busy}
            onCancel={() => setBuildingPdf(false)}
            onSubmit={(name, remarks) => {
              void executeBuildPdf(name, remarks);
            }}
          />
        )}
      </Modal>

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

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this page?"
        description={`Page ${deleteTarget?.pageNo ?? ''} (${deleteTarget?.filename ?? ''}) will be removed from the workspace permanently. This cannot be undone.`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void deletePage()}
      />

      <ConfirmDialog
        open={confirmUnpack !== null}
        title="Replace the workspace?"
        description={`Loading "${confirmUnpack?.filename ?? ''}" unpacks its pages into the studio grid and removes the ${scans.length} working page(s) currently open. The stored versions are not touched.`}
        confirmLabel="Load its pages"
        onCancel={() => setConfirmUnpack(null)}
        onConfirm={() => {
          if (confirmUnpack) void unpackVersionIntoStudio(confirmUnpack);
        }}
      />

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard the studio draft?"
        description={`All ${scans.length} working page(s) will be removed from the workspace. Stored versions stay as they are.`}
        confirmLabel="Discard draft"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => void discardDraft()}
      />
    </div>
  );
}

function BuildDeliverablePdfForm({
  defaultName,
  busy,
  onCancel,
  onSubmit,
}: {
  defaultName: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string, remarks: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [remarks, setRemarks] = useState('');

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        onSubmit(name.trim(), remarks.trim());
      }}
    >
      <Field
        label="Deliverable file name"
        htmlFor="build-pdf-filename"
        hint="Keeps the original base name and appends the next version suffix."
        required
      >
        <TextInput
          id="build-pdf-filename"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Proposal_for_Zila_Panchayat_Mahoba_v3.pdf"
          required
          autoFocus
        />
      </Field>
      <Field
        label="Remarks"
        htmlFor="build-pdf-remarks"
        hint="Optional: describe what changed in this version."
      >
        <TextArea
          id="build-pdf-remarks"
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          placeholder="Reordered pages, added supplementary sheet…"
          rows={3}
        />
      </Field>
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" icon={<FilePdf size={16} />} disabled={busy || !name.trim()}>
          {busy ? 'Building PDF…' : 'Save & Build Deliverable PDF'}
        </Button>
      </div>
    </form>
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
