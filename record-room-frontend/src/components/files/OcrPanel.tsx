import { useMemo, useState } from 'react';
import { ArrowClockwise, Check, PencilSimple, TextAa, X } from '@phosphor-icons/react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { StatusBadge } from '../ui/Flash';
import { TextInput } from '../ui/Field';
import { useFlash, useQuery, useService, useSession } from '../../hooks/useService';
import type { FileScan } from '../../types';

/**
 * The OCR tab of a document page (round 5): what the tesseract pass read for
 * each scanned page, with the two corrections an operator needs — re-run the
 * recognition (the API re-rasterizes and re-OCRs the page), or fix the text by
 * hand when the machine got a word wrong. Both stay in the page's version
 * history through the audit log.
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
  const [busyId, setBusyId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState('');

  const {
    data: pages,
    loading,
    reload,
  } = useQuery(() => service.digitization.list(fileId), [fileId], [] as FileScan[], [
    'digitization',
  ]);

  // A page is part of the OCR surface when it has a document or already
  // carries text — the seed rows and API rows can arrive text-only.
  const scanned = useMemo(
    () => pages.filter((page) => page.hasDocument || page.ocrText?.trim()),
    [pages],
  );
  const withText = scanned.filter((page) => page.ocrText?.trim());
  const visible = scanned.filter((page) => {
    if (!search.trim()) return true;
    const needle = search.toLowerCase();
    return (
      `page ${page.pageNo}`.includes(needle) ||
      (page.ocrText ?? '').toLowerCase().includes(needle) ||
      page.filename.toLowerCase().includes(needle)
    );
  });

  const regenerate = async (page: FileScan) => {
    setBusyId(page.id);
    try {
      const result = await service.digitization.runOcr(page.id);
      if (!result.ok) {
        danger(result.error);
        return;
      }
      success(`OCR re-run for page ${page.pageNo} (${result.value.method}).`);
      reload();
    } finally {
      setBusyId('');
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
      setEditingId('');
      reload();
    } finally {
      setBusyId('');
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
    return (
      <Card>
        <EmptyState
          title="No scanned pages yet"
          description="Pages appear here once the file is scanned or uploaded in the studio — their OCR text comes with them."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="muted text-sm">
          {withText.length} of {scanned.length} page(s) carry OCR text
        </p>
        <div className="flex items-center gap-2">
          <div className="sm:w-64">
            <TextInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search page text…"
              aria-label="Search OCR text"
            />
          </div>
          {withText.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => void copyAll()}>
              Copy all
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {visible.map((page) => {
          const editing = editingId === page.id;
          return (
            <Card key={page.id} padding={false} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">Page {page.pageNo}</span>
                  <span className="muted text-xs">v{page.version}</span>
                  <StatusBadge status={page.status} />
                  {page.ocrEditedBy && page.ocrEditedAt && (
                    <Badge tone="info">Edited by hand</Badge>
                  )}
                  {page.ocrEditedAt && (
                    <span className="muted text-[11px]">
                      {page.ocrEditedBy} · {new Date(page.ocrEditedAt).toLocaleString()}
                    </span>
                  )}
                </div>
                {canEditOcr && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<ArrowClockwise size={14} />}
                      disabled={busyId === page.id}
                      onClick={() => void regenerate(page)}
                    >
                      Re-run OCR
                    </Button>
                    {editing ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<X size={14} />}
                        onClick={() => setEditingId('')}
                      >
                        Cancel
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<PencilSimple size={14} />}
                        onClick={() => {
                          setEditingId(page.id);
                          setDraft(page.ocrText ?? '');
                        }}
                      >
                        Edit text
                      </Button>
                    )}
                  </div>
                )}
              </div>

              <div className="p-4">
                {editing ? (
                  <div className="space-y-3">
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      rows={8}
                      aria-label={`OCR text of page ${page.pageNo}`}
                      className="focus-ring w-full rounded-lg border border-base bg-[var(--rr-bg)] p-3 font-mono text-[13px] leading-6 outline-none"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        icon={<Check size={15} />}
                        disabled={busyId === page.id}
                        onClick={() => void save(page)}
                      >
                        Save correction
                      </Button>
                    </div>
                  </div>
                ) : page.ocrText?.trim() ? (
                  <p className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-6">
                    {page.ocrText}
                  </p>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <p className="muted flex items-center gap-2 text-sm">
                      <TextAa size={16} /> No OCR text yet — run recognition to make this page
                      searchable.
                    </p>
                    {canEditOcr && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<ArrowClockwise size={14} />}
                        disabled={busyId === page.id}
                        onClick={() => void regenerate(page)}
                      >
                        Run OCR
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
        {visible.length === 0 && (
          <Card>
            <EmptyState title="No page matches this text search" description="Try another word." />
          </Card>
        )}
      </div>
    </div>
  );
}
