import { useState } from 'react';
import {
  ArrowRight,
  CheckCircle,
  Info,
  MapPinPlus,
  Trash,
  UploadSimple,
  WarningCircle,
} from '@phosphor-icons/react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, SelectInput, TextInput } from '../ui/Field';
import { StatusBadge } from '../ui/Flash';
import { DropZone } from './DropZone';
import { useQuery, useService } from '../../hooks/useService';
import { useFeatures } from '../../lib/features';
import { pdfAcceptAttribute, validateDocumentFile, validatePdfFile } from '../../lib/document';
import { dataSource } from '../../services';
import type { MapUpload, RecordFile, Room } from '../../types';

export type FileActionKind = 'upload' | 'move' | 'mapUpload';

export interface ActionContext {
  file: RecordFile;
  onClose: () => void;
  /** Called after a successful write so the caller refetches and shows a notice. */
  onDone: (message: string) => void;
}

const EMPTY_MAPS: MapUpload[] = [];
const EMPTY_ROOMS: Room[] = [];

function FileSummary({ file }: { file: RecordFile }) {
  const { barcode } = useFeatures();
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3 rounded-xl bg-[var(--rr-bg)] p-3.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{file.fileNumber}</p>
        <p className="muted mt-0.5 line-clamp-2 text-[13px] leading-5">{file.subject}</p>
        {barcode && <p className="mono muted mt-1 text-xs">{file.fileBarcode}</p>}
      </div>
      <StatusBadge status={file.status} />
    </div>
  );
}

function Notice({ tone, children }: { tone: 'danger' | 'info'; children: React.ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm leading-5 ${
        tone === 'danger'
          ? 'border-[color-mix(in_srgb,var(--rr-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--rr-danger)_8%,transparent)]'
          : 'border-base bg-[var(--rr-bg)]'
      }`}
    >
      {tone === 'danger' ? (
        <WarningCircle
          size={18}
          weight="fill"
          className="mt-0.5 shrink-0 text-[var(--rr-danger)]"
        />
      ) : (
        <Info size={18} weight="fill" className="mt-0.5 shrink-0 text-accent" />
      )}
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- upload file

/**
 * The file-detail scan upload. Whole-PDF scans only — loose images are studio
 * material (the studio accepts them page by page and enhances them there), so
 * this picker refuses them with a pointed message instead of letting one
 * image land as the file's only "version". Several PDFs can be attached in
 * one go; each becomes its own version, reported line by line.
 */
export function UploadFileModal({ file, onClose, onDone }: ActionContext) {
  const service = useService();
  const [queue, setQueue] = useState<File[]>([]);
  const [results, setResults] = useState<{ name: string; ok: boolean; message: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const issue = queue.length === 0 ? null : queue.map(validatePdfFile).find((error) => error);

  const submit = async () => {
    const rejected = queue.map((item) => ({ item, error: validatePdfFile(item) }));
    if (rejected.some((row) => row.error)) {
      setResults(
        rejected
          .filter((row) => row.error)
          .map((row) => ({ name: row.item.name, ok: false, message: row.error! })),
      );
      setQueue(rejected.filter((row) => !row.error).map((row) => row.item));
      return;
    }
    setBusy(true);
    setResults([]);
    const done: { name: string; ok: boolean; message: string }[] = [];
    const uploaded: File[] = [];
    try {
      for (const scan of queue) {
        try {
          setStatusMsg(`Uploading ${scan.name}…`);
          const result = await service.files.uploadDocument(file.id, scan);
          if (result.ok) {
            uploaded.push(scan);
            done.push({
              name: scan.name,
              ok: true,
              message: 'stored — OCR is processing in the background',
            });
            // Trigger OCR generation in background for local demo
            if (dataSource === 'local') {
              void service.files.documentOcr(file.id, result.value.id);
            }
          } else {
            done.push({ name: scan.name, ok: false, message: result.error });
          }
        } catch (cause) {
          done.push({
            name: scan.name,
            ok: false,
            message: cause instanceof Error ? cause.message : 'Upload failed.',
          });
        }
        setResults([...done]);
      }
      const count = uploaded.length;
      if (count > 0) {
        onDone(
          count === 1
            ? `PDF uploaded to ${file.fileNumber}.`
            : `${count} PDFs uploaded to ${file.fileNumber}.`,
        );
        setQueue([]);
        onClose();
      }
    } finally {
      setBusy(false);
      setStatusMsg('');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Upload PDF"
      description="Attach the scanned copy of this file as PDF. An existing scan is kept as an earlier version."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button
            onClick={submit}
            disabled={queue.length === 0 || busy}
            icon={<UploadSimple size={17} />}
          >
            {busy
              ? statusMsg || `Uploading ${results.length + 1} of ${queue.length}…`
              : queue.length > 1
                ? `Upload ${queue.length} PDFs`
                : 'Upload PDF'}
          </Button>
        </>
      }
    >
      <FileSummary file={file} />

      <DropZone
        file={queue.length === 1 ? queue[0] : null}
        onFile={(next) => setQueue(next ? [next] : [])}
        onFiles={(files) => setQueue(files)}
        multiple
        accept={pdfAcceptAttribute()}
        label="Choose PDF scan(s) or drop them here"
        hint="PDF only · several files allowed · up to 48 MiB each · images go to the studio"
        disabled={busy}
      />
      {queue.length > 1 && (
        <p className="muted mt-3 text-xs">
          {queue.length} PDFs queued — each is uploaded as its own version.
        </p>
      )}
      {issue && (
        <div className="mt-4">
          <Notice tone="danger">{issue}</Notice>
        </div>
      )}
      {results.length > 0 && (
        <ul className="mt-4 space-y-2">
          {results.map((row) => (
            <li
              key={row.name}
              className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs leading-5 ${
                row.ok
                  ? 'border-[color-mix(in_srgb,var(--rr-success)_40%,transparent)] bg-[color-mix(in_srgb,var(--rr-success)_8%,transparent)]'
                  : 'border-[color-mix(in_srgb,var(--rr-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--rr-danger)_8%,transparent)]'
              }`}
            >
              {row.ok ? (
                <CheckCircle size={15} weight="fill" className="mt-0.5 text-[var(--rr-success)]" />
              ) : (
                <WarningCircle size={15} weight="fill" className="mt-0.5 text-[var(--rr-danger)]" />
              )}
              <span className="min-w-0 break-all">
                <strong>{row.name}</strong> — {row.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        <Notice tone="info">
          Only PDFs can be attached here. To scan or add single images page by page, use{' '}
          <strong>Edit in studio</strong> on the file page.
        </Notice>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ move file

export function MoveFileModal({ file, onClose, onDone }: ActionContext) {
  const service = useService();
  const { barcode } = useFeatures();
  const { data: rooms, loading } = useQuery(() => service.locations.listRooms(), [], EMPTY_ROOMS);

  const [roomId, setRoomId] = useState(file.roomId);
  const [sectionId, setSectionId] = useState(file.sectionId);
  const [shelfId, setShelfId] = useState('');
  const [position, setPosition] = useState(file.position || 1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const room = rooms.find((item) => item.id === roomId);
  const sections = room?.sections ?? [];
  const units = (room?.storageUnits ?? []).filter(
    (unit) => !sectionId || unit.sectionId === sectionId,
  );
  const target = units.flatMap((unit) => unit.shelves).find((shelf) => shelf.id === shelfId);
  const issued = file.status === 'Issued';

  const submit = async () => {
    if (!shelfId) return setError('Choose the shelf the file is moving to.');
    if (!Number.isFinite(position) || position < 1 || position > 100)
      return setError('Position must be a number from 1 to 100.');
    setBusy(true);
    setError(null);
    try {
      const result = await service.files.relocate(file.id, shelfId, position, reason.trim());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDone(`${file.fileNumber} moved to ${result.value.location}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not move the file. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Move file"
      description={
        barcode
          ? "Only the shelf and position change. The file's barcode and history stay the same."
          : 'Only the shelf and position change. The file and its history stay the same.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!shelfId || busy || issued}
            icon={<ArrowRight size={17} />}
          >
            {busy ? 'Moving…' : 'Move file'}
          </Button>
        </>
      }
    >
      <FileSummary file={file} />
      <div className="mb-5 rounded-xl border border-base p-3.5 text-sm">
        <p className="muted text-xs font-semibold">Currently shelved at</p>
        <p className="mt-1 font-medium">{file.location || 'No location recorded'}</p>
      </div>

      {issued ? (
        <Notice tone="danger">
          This file is issued to {file.holder ?? 'a borrower'}. Return it at the return desk before
          moving it.
        </Notice>
      ) : loading ? (
        <p role="status" className="muted py-6 text-center text-sm">
          Loading rooms…
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Room" htmlFor="move-room">
              <SelectInput
                id="move-room"
                value={roomId}
                onChange={(event) => {
                  setRoomId(event.target.value);
                  setSectionId('');
                  setShelfId('');
                }}
              >
                <option value="">Select a room</option>
                {rooms.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} — {item.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Section" htmlFor="move-section">
              <SelectInput
                id="move-section"
                value={sectionId}
                disabled={!roomId}
                onChange={(event) => {
                  setSectionId(event.target.value);
                  setShelfId('');
                }}
              >
                <option value="">All sections</option>
                {sections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} — {item.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>

          <Field label="Shelf" htmlFor="move-shelf" required>
            <SelectInput
              id="move-shelf"
              value={shelfId}
              disabled={!roomId}
              onChange={(event) => setShelfId(event.target.value)}
            >
              <option value="">{roomId ? 'Select a shelf' : 'Choose a room first'}</option>
              {units.map((unit) => (
                <optgroup key={unit.id} label={`${unit.code} — ${unit.name}`}>
                  {unit.shelves.map((shelf) => (
                    <option key={shelf.id} value={shelf.id} disabled={shelf.status !== 'Active'}>
                      {shelf.code} · {Math.max(0, shelf.capacity - shelf.occupied)} free
                      {shelf.status !== 'Active' ? ` · ${shelf.status}` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </SelectInput>
          </Field>

          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <Field label="Position (1–100)" htmlFor="move-position">
              <TextInput
                id="move-position"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                value={position}
                onChange={(event) => setPosition(Number(event.target.value))}
              />
            </Field>
            <Field label="Reason (optional)" htmlFor="move-reason">
              <TextInput
                id="move-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Reconciled during shelf audit"
              />
            </Field>
          </div>

          {target && (
            <Notice tone="info">
              Will be shelved at <strong>{target.code}</strong>
              {barcode && (
                <>
                  {' '}
                  (barcode <span className="mono text-xs">{target.barcode}</span>)
                </>
              )}
              , position {position}.
            </Notice>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
    </Modal>
  );
}

// --------------------------------------------------------------------- maps

export function UploadMapModal({ file, onClose, onDone }: ActionContext) {
  const service = useService();
  const { data: rows } = useQuery(
    () => service.uploads.maps({ fileBarcode: file.fileBarcode }),
    [file.fileBarcode],
    EMPTY_MAPS,
  );
  const nextPage = rows.reduce((max, row) => Math.max(max, row.pageNo), 0) + 1;

  const [scan, setScan] = useState<File | null>(null);
  const [pageNo, setPageNo] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const page = pageNo ?? nextPage;
  const replacing = rows.some((row) => row.pageNo === page);

  const submit = async () => {
    const issue = validateDocumentFile(scan);
    if (issue || !scan) return setError(issue ?? 'Choose a PDF or image first.');
    if (!Number.isInteger(page) || page < 1) return setError('Page number starts at 1.');
    setBusy(true);
    setError(null);
    try {
      // A page that was registered without a scan is filled in; otherwise a new
      // row is created, which is how a re-scan becomes the next version.
      let target = rows.find((row) => row.pageNo === page && !row.hasDocument);
      if (!target) {
        const created = await service.uploads.addMap({
          fileBarcode: file.fileBarcode,
          pageNo: page,
          filename: scan.name,
          sizeKb: Math.max(1, Math.ceil(scan.size / 1024)),
        });
        if (!created.ok) {
          setError(created.error);
          return;
        }
        target = created.value;
      }
      const stored = await service.uploads.uploadMapDocument(target.id, scan);
      if (!stored.ok) {
        setError(stored.error);
        return;
      }
      onDone(`Map page ${page} uploaded for ${file.fileNumber} (version ${stored.value.version}).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Upload map"
      description="Attach a scanned map page to this file."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!scan || busy} icon={<MapPinPlus size={17} />}>
            {busy ? 'Uploading…' : 'Upload map'}
          </Button>
        </>
      }
    >
      <FileSummary file={file} />
      <div className="space-y-4">
        <DropZone
          file={scan}
          onFile={(next) => {
            setScan(next);
            setError(null);
          }}
          disabled={busy}
        />
        <Field
          label="Map page number"
          htmlFor="map-page-no"
          hint={
            replacing
              ? `Page ${page} already has a scan. This upload will be saved as its next version.`
              : rows.length > 0
                ? `This file has ${rows.length} map page${rows.length === 1 ? '' : 's'} already; the next free page is ${nextPage}.`
                : 'This will be the first map page for this file.'
          }
        >
          <TextInput
            id="map-page-no"
            type="number"
            inputMode="numeric"
            min={1}
            value={page}
            onChange={(event) => setPageNo(Number(event.target.value))}
            className="sm:max-w-[160px]"
          />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- delete file

/**
 * Removing a registry row entirely. The API blocks the delete with readable
 * reasons when the file is issued, has scan pages, maps or issue history —
 * those messages surface here so the operator knows exactly what to clear.
 */
export function DeleteFileModal({ file, onClose, onDone }: ActionContext) {
  const service = useService();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await service.files.remove(file.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDone(`${file.fileNumber} was deleted from the registry.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Delete failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title="Delete this file?"
      description="The registry row and any stored attachments are removed. This cannot be undone."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Keep the file
          </Button>
          <Button variant="danger" onClick={submit} disabled={busy} icon={<Trash size={16} />}>
            {busy ? 'Deleting…' : 'Delete file'}
          </Button>
        </>
      }
    >
      <FileSummary file={file} />
      <Notice tone="danger">
        {file.fileNumber} will be deleted together with its stored scan versions. Files that are
        issued, or still have scan pages, maps or issue receipts attached, are refused with the
        reason — nothing is deleted behind your back.
      </Notice>
      {error && (
        <div className="mt-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
    </Modal>
  );
}
