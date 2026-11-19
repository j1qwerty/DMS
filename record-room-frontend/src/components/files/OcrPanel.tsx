import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowClockwise,
  Check,
  Copy,
  MagnifyingGlass,
  PencilSimple,
  TextAa,
  X,
} from '@phosphor-icons/react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { StatusBadge } from '../ui/Flash';
import { TextInput } from '../ui/Field';
import { useFlash, useQuery, useService, useSession } from '../../hooks/useService';
import { cn } from '../../lib/utils';
import { extractPdfPagesToImages } from '../../lib/pdf-unpack';
import type { DocumentDerivative, FileScan, RecordFileDocument } from '../../types';
import type { OcrStatusInfo } from '../../services/contracts';

/**
 * The OCR tab of a document page (round 5, reworked): master–detail — the page
 * list on the left carries a glanceable state chip (text / none / edited), the
 * selected page's text is edited or re-run on the right, and one button runs
 * recognition over every page that still lacks text, with live progress.
 *
 * The engine status line at the top comes from the API (GET /api/config): when
 * tesseract is missing on the server the tab says so instead of pages that
 * silently carry no text.
 *
 * Viewing is open to everyone who can open the file; regenerating and editing
 * need `digitization.upload` (Operator and above by default).
 */
export function OcrPanel({ fileId }: { fileId: string }) {
  const service = useService();
  const { allowed } = useSession();
  const { success, danger } = useFlash();
  const canEditOcr = allowed('digitization.upload');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [busyId, setBusyId] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [ocrStatus, setOcrStatus] = useState<OcrStatusInfo | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const bulkRun = useRef(0);

  const {
    data: pages,
    loading,
    reload,
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
      reload();
    } catch (err) {
      danger(err instanceof Error ? err.message : 'Could not extract PDF pages.');
    } finally {
      setUnpacking(false);
    }
  };

  // Engine status: one fetch per mount, not per page.
  useEffect(() => {
    void service.config
      .info()
      .then((info) => setOcrStatus(info.ocr))
      .catch(() => setOcrStatus(null));
  }, [service]);

  // A page is part of the OCR surface when it has a document or already
  // carries text — the seed rows and API rows can arrive text-only.
  const scanned = useMemo(
    () => pages.filter((page) => page.hasDocument || page.ocrText?.trim()),
    [pages],
  );
  const withText = scanned.filter((page) => page.ocrText?.trim());
  const withoutText = scanned.filter((page) => !page.ocrText?.trim());
  const visible = scanned.filter((page) => {
    if (!search.trim()) return true;
    const needle = search.toLowerCase();
    return (
      `page ${page.pageNo}`.includes(needle) ||
      (page.ocrText ?? '').toLowerCase().includes(needle) ||
      page.filename.toLowerCase().includes(needle)
    );
  });

  const selected = scanned.find((page) => page.id === selectedId) ?? visible[0] ?? scanned[0];

  const regenerate = async (page: FileScan) => {
    setBusyId(page.id);
    try {
      const result = await service.digitization.runOcr(page.id);
      if (!result.ok) {
        danger(result.error);
        return;
      }
      const found = result.value.ocrText.trim().length > 0;
      if (found) {
        success(`OCR re-run for page ${page.pageNo} (${result.value.method}).`);
      } else {
        danger(
          `OCR ran for page ${page.pageNo} but found no text (${result.value.method}). ` +
            'A very dark or blurry scan can come back empty — try enhancing it in the studio first.',
        );
      }
      reload();
    } finally {
      setBusyId('');
    }
  };

  const runAll = async () => {
    const targets = withoutText.filter((page) => page.hasDocument);
    if (targets.length === 0) return;
    const run = ++bulkRun.current;
    setBulk({ done: 0, total: targets.length });
    let okCount = 0;
    let foundCount = 0;
    try {
      for (const [index, page] of targets.entries()) {
        if (bulkRun.current !== run) return;
        const result = await service.digitization.runOcr(page.id);
        if (result.ok) {
          okCount++;
          if (result.value.ocrText.trim()) foundCount++;
        } else {
          danger(result.error);
          return;
        }
        setBulk({ done: index + 1, total: targets.length });
      }
      success(`OCR ran on ${okCount} page(s); ${foundCount} produced text.`);
      reload();
    } finally {
      if (bulkRun.current === run) setBulk(null);
    }
  };

  const save = async (page: FileScan) => {
    setBusyId(page.id);
    try {
      const result = await service.digitization.saveOcrText(page.id, draft);
      if (!result.ok) {
        danger(result.error);
        return;
      }
      success(`OCR text saved for page ${page.pageNo}.`);
      setEditing(false);
      reload();
    } finally {
      setBusyId('');
    }
  };

  const copyPage = async (page: FileScan) => {
    try {
      await navigator.clipboard.writeText(page.ocrText ?? '');
      success(`Page ${page.pageNo} text copied.`);
    } catch {
      danger('The browser blocked clipboard access.');
    }
  };

  const copyAll = async () => {
    const text = scanned
      .map((page) => `--- Page ${page.pageNo} (v${page.version}) ---\n${page.ocrText ?? ''}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      success('OCR text of all pages copied.');
    } catch {
      danger('The browser blocked clipboard access.');
    }
  };

  if (!loading && scanned.length === 0) {
    const hasPdfs = docs.length > 0 || derivatives.length > 0;
    return (
      <Card>
        <EmptyState
          title={hasPdfs ? 'Pages not unpacked for OCR yet' : 'No scanned pages yet'}
          description={
            hasPdfs
              ? `This file has ${docs.length + derivatives.length} attached document(s), but its pages haven't been unpacked for OCR.`
              : 'Pages appear here once the file is scanned or uploaded — their OCR text comes with them.'
          }
          action={
            hasPdfs && canEditOcr ? (
              <Button
                variant="secondary"
                icon={<ArrowClockwise size={15} />}
                disabled={unpacking}
                onClick={() => void unpackAttachedPdf()}
              >
                {unpacking ? 'Unpacking pages & running OCR…' : 'Unpack attached PDF for OCR'}
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status strip: engine + coverage + bulk action, glanceable in one line. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={withText.length === scanned.length ? 'success' : 'warning'}>
            {withText.length}/{scanned.length} pages with text
          </Badge>
          {ocrStatus && !ocrStatus.available && <Badge tone="danger">OCR engine unavailable</Badge>}
          <span className="muted">
            {ocrStatus
              ? ocrStatus.available
                ? `${ocrStatus.engine} · ${ocrStatus.languages}`
                : ocrStatus.note
              : 'OCR status unknown.'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-56">
            <div className="relative">
              <MagnifyingGlass
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--rr-muted)]"
              />
              <TextInput
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search page text…"
                aria-label="Search OCR text"
                className="!pl-9"
              />
            </div>
          </div>
          {canEditOcr && withoutText.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              icon={<ArrowClockwise size={14} />}
              disabled={bulk !== null}
              onClick={() => void runAll()}
            >
              {bulk
                ? `Running ${bulk.done}/${bulk.total}…`
                : `Run OCR on ${withoutText.length} page(s) without text`}
            </Button>
          )}
          {withText.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy size={14} />}
              onClick={() => void copyAll()}
            >
              Copy all
            </Button>
          )}
        </div>
      </div>

      {bulk && (
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--rr-surface-2)]">
          <div
            className="h-full rounded-full bg-[var(--rr-accent)] transition-all"
            style={{ width: `${Math.round((bulk.done / bulk.total) * 100)}%` }}
          />
        </div>
      )}

      {/* Master–detail: page list left, the selected page's text right. */}
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card padding={false} className="overflow-hidden">
          <ul className="max-h-[70vh] divide-y divide-[var(--rr-border)] overflow-y-auto">
            {visible.map((page) => {
              const hasText = Boolean(page.ocrText?.trim());
              const isSelected = selected?.id === page.id;
              return (
                <li key={page.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(page.id);
                      setEditing(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-3 text-left transition',
                      isSelected
                        ? 'bg-accent-soft/40 border-l-[3px] border-[var(--rr-accent)]'
                        : 'hover:bg-[var(--rr-surface-2)] border-l-[3px] border-transparent',
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-lg',
                        hasText
                          ? 'bg-[color-mix(in_srgb,var(--rr-success)_14%,transparent)] text-[var(--rr-success)]'
                          : 'bg-[var(--rr-surface-2)] text-[var(--rr-muted)]',
                      )}
                    >
                      <TextAa size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        Page {page.pageNo}
                        <span className="muted text-[11px] font-normal">v{page.version}</span>
                      </span>
                      <span className="muted mt-0.5 block truncate text-[11px]">
                        {hasText
                          ? `${page.ocrText!.trim().slice(0, 60)}${page.ocrText!.trim().length > 60 ? '…' : ''}`
                          : 'No OCR text'}
                      </span>
                    </span>
                    {page.ocrEditedBy && page.ocrEditedAt ? (
                      <Badge tone="info">edited</Badge>
                    ) : hasText ? (
                      <Badge tone="success">text</Badge>
                    ) : (
                      <Badge tone="neutral">none</Badge>
                    )}
                  </button>
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className="muted p-5 text-center text-xs">No page matches this text search.</li>
            )}
          </ul>
        </Card>

        <Card padding={false} className="overflow-hidden">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">Page {selected.pageNo}</span>
                  <span className="muted text-xs">v{selected.version}</span>
                  <StatusBadge status={selected.status} />
                  {selected.ocrEditedBy && selected.ocrEditedAt && (
                    <Badge tone="info">Edited by hand</Badge>
                  )}
                  {selected.ocrEditedAt && (
                    <span className="muted text-[11px]">
                      {selected.ocrEditedBy} · {new Date(selected.ocrEditedAt).toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {selected.ocrText?.trim() && !editing && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Copy size={14} />}
                      onClick={() => void copyPage(selected)}
                    >
                      Copy
                    </Button>
                  )}
                  {canEditOcr && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<ArrowClockwise size={14} />}
                        disabled={busyId === selected.id || bulk !== null}
                        onClick={() => void regenerate(selected)}
                      >
                        {selected.ocrText?.trim() ? 'Re-run OCR' : 'Run OCR'}
                      </Button>
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
                            setDraft(selected.ocrText ?? '');
                          }}
                        >
                          Edit text
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="p-4">
                {editing ? (
                  <div className="space-y-3">
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      rows={16}
                      aria-label={`OCR text of page ${selected.pageNo}`}
                      className="focus-ring w-full rounded-lg border border-base bg-[var(--rr-bg)] p-3 font-mono text-[13px] leading-6 outline-none"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        icon={<Check size={15} />}
                        disabled={busyId === selected.id}
                        onClick={() => void save(selected)}
                      >
                        Save correction
                      </Button>
                    </div>
                  </div>
                ) : selected.ocrText?.trim() ? (
                  <p className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--rr-bg)] p-4 font-mono text-[13px] leading-6">
                    {selected.ocrText}
                  </p>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                    <TextAa size={28} className="text-[var(--rr-muted)]" />
                    <p className="muted text-sm">
                      No OCR text on this page yet — run recognition to make it searchable.
                    </p>
                    {canEditOcr && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<ArrowClockwise size={14} />}
                        disabled={busyId === selected.id || bulk !== null}
                        onClick={() => void regenerate(selected)}
                      >
                        Run OCR on this page
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-6">
              <EmptyState
                title="No page matches this text search"
                description="Try another word."
              />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
