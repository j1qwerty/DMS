import { useState } from 'react';
import { ArrowRight, Info, MapPinPlus, UploadSimple, WarningCircle } from '@phosphor-icons/react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, SelectInput, TextInput } from '../ui/Field';
import { StatusBadge } from '../ui/Flash';
import { DropZone } from './DropZone';
import { useQuery, useService } from '../../hooks/useService';
import { useFeatures } from '../../lib/features';
import { validateDocumentFile } from '../../lib/document';
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

export function UploadFileModal({ file, onClose, onDone }: ActionContext) {
  const service = useService();
  const [scan, setScan] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const issue = validateDocumentFile(scan);
    if (issue || !scan) {
      setError(issue ?? 'Choose a PDF or image first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await service.files.uploadDocument(file.id, scan);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDone(`Scan uploaded to ${file.fileNumber} as version ${result.value.version}.`);
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
      title="Upload file scan"
      description="Attach the scanned copy of this file. An existing scan is kept as an earlier version."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!scan || busy} icon={<UploadSimple size={17} />}>
            {busy ? 'Uploading…' : 'Upload scan'}
          </Button>
        </>
      }
    >
      <FileSummary file={file} />
      <DropZone
        file={scan}
        onFile={(next) => {
          setScan(next);
          setError(null);
        }}
        disabled={busy}
      />
      {error && (
        <div className="mt-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
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
