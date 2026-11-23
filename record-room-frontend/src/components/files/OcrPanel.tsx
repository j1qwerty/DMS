import { useEffect, useMemo, useState, Suspense } from 'react';
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  MagnifyingGlass,
  PencilSimple,
  Spinner,
  TextAa,
  X,
} from '@phosphor-icons/react';
import { Document, Page } from 'react-pdf';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { TextInput } from '../ui/Field';
import { useFlash, useQuery, useService, useSession } from '../../hooks/useService';
import { authoritativeScanRows } from '../../lib/scanMerge';
import { extractPdfPagesToImages } from '../../lib/pdf-unpack';
import type { DocumentDerivative, FileScan, RecordFileDocument } from '../../types';
import type { OcrStatusInfo } from '../../services/contracts';

const PDF_OPTIONS = {
  cMapUrl: '/cmaps/',
  standardFontDataUrl: '/standard_fonts/',
  wasmUrl: '/wasm/',
  verbosity: 0,
} as const;

interface UnifiedOcrVersion {
  id: string;
  source: 'document' | 'derivative' | 'scans';
  filename: string;
  versionLabel: string;
  pageCount: number;
}

export function OcrPanel({ fileId }: { fileId: string }) {
  const service = useService();
  const { allowed } = useSession();
  const { success, danger } = useFlash();
  const canEditOcr = allowed('digitization.upload');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [ocrStatus, setOcrStatus] = useState<OcrStatusInfo | null>(null);
  const [savingOcr, setSavingOcr] = useState(false);

  const {
    data: pages,
    loading: scansLoading,
    reload: reloadScans,
  } = useQuery(() => service.digitization.list(fileId), [fileId], [] as FileScan[], [
    'digitization',
  ]);

  const { data: docs } = useQuery(
    () => service.files.listDocuments(fileId),
    [fileId],
    [] as RecordFileDocument[],
    ['files'],
  );

  const { data: derivatives } = useQuery(
    () => service.digitization.listPdfs(fileId),
    [fileId],
    [] as DocumentDerivative[],
    ['digitization'],
  );

  const [unpacking, setUnpacking] = useState(false);

  // Versions available for OCR
  const allVersions = useMemo(() => {
    const list: UnifiedOcrVersion[] = [];
    for (const doc of docs) {
      list.push({
        id: doc.id,
        source: 'document',
        filename: doc.filename,
        versionLabel: `v${doc.version}`,
        pageCount: doc.pageCount ?? 1,
      });
    }
    for (const deriv of derivatives) {
      list.push({
        id: deriv.id,
        source: 'derivative',
        filename: deriv.filename,
        versionLabel: `Build ${deriv.id}`,
        pageCount: deriv.pageCount,
      });
    }
    if (pages.length > 0) {
      list.push({
        id: 'studio-workspace',
        source: 'scans',
        filename: 'Studio Workspace Scans',
        versionLabel: `${pages.length} page(s)`,
        pageCount: pages.length,
      });
    }
    return list;
  }, [docs, derivatives, pages]);

  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const activeVersion = allVersions.find((v) => v.id === selectedVersionId) ?? allVersions[0];

  // Engine status
  useEffect(() => {
    void service.config
      .info()
      .then((info) => setOcrStatus(info.ocr))
      .catch(() => setOcrStatus(null));
  }, [service]);

  // Current page for active version
  const [currentPage, setCurrentPage] = useState(1);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [numPdfPages, setNumPdfPages] = useState(0);
  const [versionOcrMap, setVersionOcrMap] = useState<Record<number, string>>({});
  const [loadingVersion, setLoadingVersion] = useState(false);

  const [prevVersionKey, setPrevVersionKey] = useState(activeVersion?.id);
  if (activeVersion?.id !== prevVersionKey) {
    setPrevVersionKey(activeVersion?.id);
    setCurrentPage(1);
    setPdfBlobUrl(null);
    setVersionOcrMap({});
    if (activeVersion && activeVersion.source !== 'scans') {
      setLoadingVersion(true);
    }
  }

  // When active version changes, load its blob and its stored OCR map
  useEffect(() => {
    if (!activeVersion || activeVersion.source === 'scans') {
      return;
    }
    let live = true;
    let url: string | null = null;

    const loadBlob =
      activeVersion.source === 'document'
        ? service.files.documentBlob(fileId, activeVersion.id)
        : service.digitization.pdfBlob(activeVersion.id);

    const loadOcr =
      activeVersion.source === 'document'
        ? service.files.documentOcr(fileId, activeVersion.id)
        : Promise.resolve({});

    void Promise.all([loadBlob, loadOcr])
      .then(([blob, ocr]) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setPdfBlobUrl(url);
        if (ocr && Object.keys(ocr).length > 0) {
          setVersionOcrMap(ocr);
        } else {
          setVersionOcrMap({});
        }
      })
      .catch(() => {
        if (live) danger('Could not load version for OCR.');
      })
      .finally(() => {
        if (live) setLoadingVersion(false);
      });

    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [activeVersion, fileId, service, danger]);

  // Workspace scans mapping (when activeVersion is 'scans' or fallback)
  const scanned = useMemo(
    () => authoritativeScanRows(pages).filter((page) => page.hasDocument || page.ocrText?.trim()),
    [pages],
  );

  const selectedScan =
    activeVersion?.source === 'scans' ? (scanned[currentPage - 1] ?? scanned[0]) : null;

  // Scan blob for workspace scans
  const selectedScanId = selectedScan?.id;
  const selectedScanHasDoc = selectedScan?.hasDocument;
  const [scanPreviewUrl, setScanPreviewUrl] = useState<string | null>(null);

  const [prevScanId, setPrevScanId] = useState(selectedScanId);
  if (selectedScanId !== prevScanId) {
    setPrevScanId(selectedScanId);
    setScanPreviewUrl(null);
  }

  useEffect(() => {
    if (!selectedScanId || !selectedScanHasDoc) {
      return;
    }
    let live = true;
    let url: string | null = null;
    service.digitization
      .scanBlob(selectedScanId)
      .then((blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setScanPreviewUrl(url);
      })
      .catch(() => {
        if (live) setScanPreviewUrl(null);
      });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [selectedScanId, selectedScanHasDoc, service]);

  const totalPages =
    activeVersion?.source === 'scans'
      ? scanned.length
      : Math.max(numPdfPages, activeVersion?.pageCount ?? 1);

  // Left/right arrow keys navigate pages while panel is open
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (editing) return;
      event.preventDefault();
      if (event.key === 'ArrowLeft') {
        setCurrentPage((p) => Math.max(1, p - 1));
        setEditing(false);
      } else {
        setCurrentPage((p) => Math.min(totalPages, p + 1));
        setEditing(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [totalPages, editing]);

  const currentOcrText =
    activeVersion?.source === 'scans'
      ? (selectedScan?.ocrText ?? '')
      : (versionOcrMap[currentPage] ?? '');

  const saveOcrCorrection = async () => {
    setSavingOcr(true);
    try {
      if (activeVersion?.source === 'document') {
        const res = await service.files.saveDocumentOcr(
          fileId,
          activeVersion.id,
          currentPage,
          draft,
        );
        if (res.ok) {
          setVersionOcrMap((prev) => ({ ...prev, [currentPage]: draft }));
          success(`OCR text saved for page ${currentPage}.`);
          setEditing(false);
        } else {
          danger(res.error);
        }
      } else if (selectedScan) {
        const res = await service.digitization.saveOcrText(selectedScan.id, draft);
        if (res.ok) {
          success(`OCR text saved for page ${selectedScan.pageNo}.`);
          setEditing(false);
          reloadScans();
        } else {
          danger(res.error);
        }
      }
    } finally {
      setSavingOcr(false);
    }
  };

  const copyCurrentPage = async () => {
    try {
      await navigator.clipboard.writeText(currentOcrText);
      success(`Page ${currentPage} text copied.`);
    } catch {
      danger('Clipboard access blocked.');
    }
  };

  const copyAllPages = async () => {
    if (activeVersion?.source === 'scans') {
      const text = scanned
        .map((p) => `--- Page ${p.pageNo} (v${p.version}) ---\n${p.ocrText ?? ''}`)
        .join('\n\n');
      try {
        await navigator.clipboard.writeText(text);
        success('OCR text of all pages copied.');
      } catch {
        danger('Clipboard access blocked.');
      }
    } else {
      const entries = Object.entries(versionOcrMap).sort(([a], [b]) => Number(a) - Number(b));
      const text = entries.map(([p, t]) => `--- Page ${p} ---\n${t}`).join('\n\n');
      try {
        await navigator.clipboard.writeText(text);
        success('OCR text of all pages copied.');
      } catch {
        danger('Clipboard access blocked.');
      }
    }
  };

  const unpackAttachedPdf = async () => {
    const targetDoc = docs[0];
    const targetDeriv = derivatives[0];
    if (!targetDoc && !targetDeriv) return;

    setUnpacking(true);
    try {
      let blob: Blob;
      let filename: string;
      if (targetDoc) {
        blob = await service.files.documentBlob(fileId, targetDoc.id);
        filename = targetDoc.filename;
      } else {
        blob = await service.digitization.pdfBlob(targetDeriv.id);
        filename = targetDeriv.filename;
      }
      const extracted = await extractPdfPagesToImages(blob, filename);
      let pageNo = 0;
      for (const pageFile of extracted) {
        pageNo += 1;
        const added = await service.digitization.add(fileId, {
          pageNo,
          filename: pageFile.name,
          documentSize: 'A4',
          note: `Extracted from ${filename}`,
        });
        if (added.ok) {
          await service.digitization.addDocument(added.value.id, pageFile);
        }
      }
      success(`Extracted ${extracted.length} page(s) from ${filename}. OCR is running.`);
      reloadScans();
    } catch (err) {
      danger(err instanceof Error ? err.message : 'Could not extract PDF pages.');
    } finally {
      setUnpacking(false);
    }
  };

  if (!scansLoading && allVersions.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No documents or scans yet"
          description="Upload a PDF document to view and manage OCR text."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Bar: Version Selection + OCR status + Search */}
      <div className="flex flex-col gap-3 rounded-xl border border-base bg-[var(--rr-surface)] p-3 lg:flex-row lg:items-center lg:justify-between shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--rr-muted)]">Version:</span>
            <select
              value={activeVersion?.id ?? ''}
              onChange={(e) => {
                setSelectedVersionId(e.target.value);
                setEditing(false);
              }}
              className="focus-ring h-8 max-w-sm rounded-lg border border-base bg-[var(--rr-bg)] px-2.5 text-xs font-semibold outline-none"
              aria-label="Select document version for OCR"
            >
              {allVersions.map((ver, idx) => (
                <option key={ver.id} value={ver.id}>
                  {idx === 0 ? '★ Current · ' : ''}
                  {ver.filename} ({ver.versionLabel})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 text-xs">
            {ocrStatus && !ocrStatus.available && <Badge tone="danger">OCR engine offline</Badge>}
            <span className="muted hidden sm:inline text-[11px]">
              {ocrStatus?.available
                ? `${ocrStatus.engine} · ${ocrStatus.languages}`
                : (ocrStatus?.note ?? 'OCR engine ready')}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-48">
            <div className="relative">
              <MagnifyingGlass
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--rr-muted)]"
              />
              <TextInput
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search OCR text…"
                aria-label="Search OCR text"
                className="!h-8 !pl-8 text-xs"
              />
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<Copy size={14} />}
            onClick={() => void copyAllPages()}
          >
            Copy all
          </Button>
          {docs.length > 0 && pages.length === 0 && canEditOcr && (
            <Button
              size="sm"
              variant="secondary"
              icon={<ArrowClockwise size={14} />}
              disabled={unpacking}
              onClick={() => void unpackAttachedPdf()}
            >
              {unpacking ? 'Unpacking…' : 'Unpack for Studio'}
            </Button>
          )}
        </div>
      </div>

      {/* Main Body: Preview on Left, Page Selection on Top + OCR on Right */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)]">
        {/* Left Side: Page Preview */}
        <Card padding={false} className="overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-base px-4 py-2.5">
            <span className="text-sm font-semibold">Preview · Page {currentPage}</span>
            <span className="muted text-xs">
              {activeVersion?.filename} ({activeVersion?.versionLabel})
            </span>
          </div>

          <div className="grid min-h-[520px] h-[64vh] place-items-center overflow-auto bg-[var(--rr-bg)] p-3">
            {loadingVersion ? (
              <div className="flex flex-col items-center gap-2 text-xs muted">
                <Spinner size={24} className="animate-spin text-accent" />
                <span>Loading preview…</span>
              </div>
            ) : pdfBlobUrl ? (
              <Suspense
                fallback={
                  <div className="flex items-center justify-center text-xs muted">
                    Loading page…
                  </div>
                }
              >
                <Document
                  file={pdfBlobUrl}
                  options={PDF_OPTIONS}
                  onLoadSuccess={(pdf) => setNumPdfPages(pdf.numPages)}
                  loading={
                    <div className="flex items-center justify-center text-xs muted">
                      Loading PDF…
                    </div>
                  }
                >
                  <Page
                    key={`${activeVersion?.id}-${currentPage}`}
                    pageNumber={currentPage}
                    scale={0.9}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    className="mx-auto rounded shadow-sm"
                  />
                </Document>
              </Suspense>
            ) : scanPreviewUrl ? (
              <img
                src={scanPreviewUrl}
                alt={`Page ${currentPage}`}
                className="max-h-full max-w-full rounded-lg object-contain shadow-sm"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-center text-xs muted">
                <TextAa size={28} className="text-[var(--rr-muted)]" />
                <span>No preview image for this page.</span>
              </div>
            )}
          </div>
        </Card>

        {/* Right Side: Page Selector on Top + OCR Text Card */}
        <div className="space-y-3 flex flex-col">
          {/* Page Selection Bar on top with Prev/Next buttons and keyboard arrow hint */}
          <div className="flex items-center justify-between gap-2 rounded-xl border border-base bg-[var(--rr-surface)] p-2.5 shadow-sm">
            <Button
              size="sm"
              variant="secondary"
              icon={<ArrowLeft size={13} />}
              disabled={currentPage <= 1}
              onClick={() => {
                setCurrentPage((p) => Math.max(1, p - 1));
                setEditing(false);
              }}
              title="Previous page (Left arrow)"
            >
              Previous page
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">
                Page {currentPage} of {totalPages}
              </span>
              <span className="muted hidden sm:inline text-[11px]">(← / → arrow keys)</span>
            </div>
            <Button
              size="sm"
              variant="secondary"
              icon={<ArrowRight size={13} />}
              disabled={currentPage >= totalPages}
              onClick={() => {
                setCurrentPage((p) => Math.min(totalPages, p + 1));
                setEditing(false);
              }}
              title="Next page (Right arrow)"
            >
              Next page
            </Button>
          </div>

          {/* OCR text card */}
          <Card padding={false} className="overflow-hidden flex-1 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base px-4 py-2.5">
              <span className="text-sm font-semibold">OCR text · page {currentPage}</span>
              <div className="flex flex-wrap items-center gap-2">
                {currentOcrText.trim() && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Copy size={14} />}
                    onClick={() => void copyCurrentPage()}
                  >
                    Copy
                  </Button>
                )}
                {canEditOcr && (
                  <>
                    {editing ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<X size={14} />}
                        onClick={() => setEditing(false)}
                      >
                        Cancel
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<PencilSimple size={14} />}
                        onClick={() => {
                          setEditing(true);
                          setDraft(currentOcrText);
                        }}
                      >
                        Edit text
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="p-4 flex-1 flex flex-col">
              {editing ? (
                <div className="space-y-3 flex-1 flex flex-col">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={16}
                    aria-label={`OCR text of page ${currentPage}`}
                    className="focus-ring flex-1 w-full rounded-lg border border-base bg-[var(--rr-bg)] p-3 font-mono text-[13px] leading-6 outline-none"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      icon={<Check size={15} />}
                      disabled={savingOcr}
                      onClick={() => void saveOcrCorrection()}
                    >
                      {savingOcr ? 'Saving…' : 'Save correction'}
                    </Button>
                  </div>
                </div>
              ) : currentOcrText.trim() ? (
                <div className="flex-1 overflow-y-auto max-h-[55vh] rounded-lg bg-[var(--rr-bg)] p-4 font-mono text-[13px] leading-6 whitespace-pre-wrap break-words">
                  {currentOcrText}
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
                  <TextAa size={32} className="text-[var(--rr-muted)]" />
                  <p className="muted text-sm font-medium">
                    No OCR text recorded for page {currentPage}.
                  </p>
                  <p className="muted text-xs max-w-sm">
                    OCR runs in the background upon document upload. Once generated or edited, it is
                    permanently saved in the database.
                  </p>
                  {canEditOcr && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<PencilSimple size={14} />}
                      onClick={() => {
                        setEditing(true);
                        setDraft('');
                      }}
                    >
                      Enter page text manually
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
