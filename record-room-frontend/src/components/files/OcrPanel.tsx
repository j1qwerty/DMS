import { Suspense, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy } from '@phosphor-icons/react';
import { Document, Page } from 'react-pdf';
import { usePageKeys } from '../../hooks/usePageKeys';
import { useFlash, useService, useSession } from '../../hooks/useService';
import { authoritativeScanRows } from '../../lib/scanMerge';
import type { FileScan } from '../../types';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { StatusBadge } from '../ui/Flash';

const PDF_OPTIONS = {
  cMapUrl: '/cmaps/',
  standardFontDataUrl: '/standard_fonts/',
  wasmUrl: '/wasm/',
};

export function OcrPanel({ pages }: { pages: FileScan[] }) {
  const scans = useMemo(
    () => authoritativeScanRows(pages).filter((page) => page.hasDocument || page.ocrText?.trim()),
    [pages],
  );
  const [position, setPosition] = useState(0);
  const index = Math.min(position, scans.length - 1);
  const page = scans[index];
  const step = (delta: number) =>
    setPosition(Math.max(0, Math.min(scans.length - 1, index + delta)));
  const [editing, setEditing] = useState(false);
  usePageKeys(step, scans.length > 1 && !editing);

  if (!page)
    return <EmptyState title="No scans to review" description="Open Studio to add pages." />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<ArrowLeft size={15} />}
          aria-label="Previous page"
          disabled={index === 0 || editing}
          onClick={() => step(-1)}
        />
        <span className="text-xs font-semibold">
          {index + 1} / {scans.length}
        </span>
        <Button
          variant="secondary"
          size="sm"
          icon={<ArrowRight size={15} />}
          aria-label="Next page"
          disabled={index === scans.length - 1 || editing}
          onClick={() => step(1)}
        />
      </div>
      <WorkspacePage key={page.id} page={page} scans={scans} onEditing={setEditing} />
    </div>
  );
}

function WorkspacePage({
  page,
  scans,
  onEditing,
}: {
  page: FileScan;
  scans: FileScan[];
  onEditing: (editing: boolean) => void;
}) {
  const service = useService();
  const { allowed } = useSession();
  const { success, danger } = useFlash();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ url: string; pdf: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const canEdit = allowed('digitization.upload');

  useEffect(() => {
    if (!page.hasDocument) return;
    let live = true;
    let url: string | null = null;
    void service.digitization
      .scanBlob(page.id, page.hasProcessed ? 'processed' : 'original')
      .then((blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setPreview({ url, pdf: blob.type === 'application/pdf' });
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [page.id, page.hasDocument, page.hasProcessed, service]);

  const edit = (text: string | null) => {
    setDraft(text);
    onEditing(text !== null);
  };

  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    try {
      const result = await service.digitization.saveOcrText(page.id, draft);
      if (result.ok) {
        edit(null);
        success(`OCR text saved for page ${page.pageNo}.`);
      } else danger(result.error);
    } catch {
      danger('Could not save the OCR correction.');
    } finally {
      setSaving(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      success('Text copied.');
    } catch {
      danger('Clipboard access blocked.');
    }
  };

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(290px,36%)]">
      <Card padding={false} className="min-w-0 overflow-hidden">
        <div className="border-b border-base px-4 py-3 text-sm font-semibold">{page.filename}</div>
        <div className="flex min-h-72 justify-center overflow-auto bg-[var(--rr-surface-2)] p-3 lg:h-[calc(100dvh-20rem)]">
          {preview?.pdf ? (
            <Suspense fallback={<p className="muted text-sm">Loading preview…</p>}>
              <Document file={preview.url} options={PDF_OPTIONS}>
                <Page
                  pageNumber={page.pageIndex ?? 1}
                  width={540}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                />
              </Document>
            </Suspense>
          ) : preview ? (
            <img
              src={preview.url}
              alt={page.filename}
              className="max-w-full self-start object-contain"
            />
          ) : (
            <p className="muted self-center text-sm">
              {failed || !page.hasDocument ? 'Preview unavailable.' : 'Loading preview…'}
            </p>
          )}
        </div>
      </Card>
      <Card padding={false} className="min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base px-4 py-2.5">
          <p className="text-sm font-semibold">OCR text · page {page.pageNo}</p>
          <StatusBadge status={page.status} />
        </div>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            {!!page.ocrText?.trim() && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Copy size={14} />}
                onClick={() => void copy(page.ocrText ?? '')}
              >
                Copy
              </Button>
            )}
            {scans.some((scan) => scan.ocrText?.trim()) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void copy(
                    scans.map((scan) => `Page ${scan.pageNo}\n${scan.ocrText ?? ''}`).join('\n\n'),
                  )
                }
              >
                Copy all
              </Button>
            )}
            {canEdit && draft === null && (
              <Button size="sm" variant="secondary" onClick={() => edit(page.ocrText ?? '')}>
                Edit text
              </Button>
            )}
          </div>
          {draft !== null ? (
            <>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={14}
                aria-label="OCR correction"
                className="focus-ring w-full rounded-lg border border-base bg-[var(--rr-bg)] p-3 text-sm"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" disabled={saving} onClick={() => edit(null)}>
                  Cancel
                </Button>
                <Button size="sm" disabled={saving} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Save correction'}
                </Button>
              </div>
            </>
          ) : (
            <p className="max-h-[56vh] overflow-auto whitespace-pre-wrap break-words text-sm leading-6">
              {page.ocrText?.trim() ||
                (page.status === 'Processing'
                  ? 'OCR is processing.'
                  : 'No saved text for this page.')}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
