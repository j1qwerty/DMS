import { useState } from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, SelectInput, TextInput } from '../ui/Field';
import { useQuery, useService } from '../../hooks/useService';
import type { RecordFile, Room } from '../../types';

/**
 * Bulk relocate (E4). The single-file move is one shelf change; for a selection
 * the same `files.relocate` call runs once per file, sequentially, and the
 * summary reports both the moves and the refusals by name. Issued files cannot
 * move — the API refuses them, so they are counted up front instead.
 */
export function BulkMoveModal({
  files,
  onClose,
  onDone,
}: {
  files: RecordFile[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const service = useService();
  const { data: rooms, loading } = useQuery(() => service.locations.listRooms(), [], [] as Room[]);

  const [roomId, setRoomId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [shelfId, setShelfId] = useState('');
  const [position, setPosition] = useState(1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const movable = files.filter((file) => file.status !== 'Issued');
  const heldBack = files.length - movable.length;

  const room = rooms.find((item) => item.id === roomId);
  const sections = room?.sections ?? [];
  const shelves = (room?.storageUnits ?? [])
    .filter((unit) => !sectionId || unit.sectionId === sectionId)
    .flatMap((unit) => {
      const section = room?.sections.find((item) => item.id === unit.sectionId);
      return unit.shelves.map((shelf) => ({
        id: shelf.id,
        label: [room?.code, section?.code, unit.code, shelf.code].filter(Boolean).join(' / '),
      }));
    });

  const submit = async () => {
    if (!shelfId) return setError('Choose the shelf the files move to.');
    if (!Number.isFinite(position) || position < 1 || position > 100)
      return setError('Position must be a number from 1 to 100.');
    setBusy(true);
    setError(null);
    let moved = 0;
    let refused = 0;
    let firstRefusal = '';
    for (const file of movable) {
      const result = await service.files.relocate(
        file.id,
        shelfId,
        position,
        reason.trim() || 'Bulk move',
      );
      if (result.ok) moved += 1;
      else {
        refused += 1;
        if (!firstRefusal) firstRefusal = `${file.fileNumber}: ${result.error}`;
      }
    }
    setBusy(false);
    if (moved === 0) {
      setError(firstRefusal || 'Nothing could be moved. Try the files one by one.');
      return;
    }
    onDone(
      `${moved} of ${movable.length} file(s) relocated.` +
        (refused > 0 ? ` ${refused} refused (${firstRefusal}).` : ''),
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Relocate ${movable.length} file(s)`}
      description="Every selected file moves to the shelf below with the same position."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!shelfId || busy || movable.length === 0}
            icon={<ArrowRight size={17} />}
          >
            {busy ? `Moving ${movable.length} file(s)…` : `Move ${movable.length} file(s)`}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="muted text-sm">Loading rooms…</p>
      ) : (
        <div className="space-y-4">
          {heldBack > 0 && (
            <p className="rounded-xl bg-accent-soft p-3 text-xs leading-6">
              {heldBack} issued file(s) in the selection cannot move — return them first. They will
              be skipped.
            </p>
          )}
          <Field label="Room" htmlFor="bulk-room">
            <SelectInput
              id="bulk-room"
              value={roomId}
              onChange={(event) => {
                setRoomId(event.target.value);
                setSectionId('');
                setShelfId('');
              }}
            >
              <option value="">Pick a room</option>
              {rooms.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Section" htmlFor="bulk-section">
            <SelectInput
              id="bulk-section"
              value={sectionId}
              onChange={(event) => {
                setSectionId(event.target.value);
                setShelfId('');
              }}
              disabled={!roomId}
            >
              <option value="">{roomId ? 'All sections' : 'Pick a room first'}</option>
              {sections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Shelf" htmlFor="bulk-shelf" required>
            <SelectInput
              id="bulk-shelf"
              value={shelfId}
              onChange={(event) => setShelfId(event.target.value)}
              disabled={!roomId}
            >
              <option value="">{roomId ? 'Pick a shelf' : 'Pick a room first'}</option>
              {shelves.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Position" htmlFor="bulk-position" hint="1–100, along the shelf.">
              <TextInput
                id="bulk-position"
                type="number"
                min={1}
                max={100}
                value={position}
                onChange={(event) => setPosition(Number(event.target.value))}
              />
            </Field>
            <Field label="Reason" htmlFor="bulk-reason" hint="Recorded in the movement log.">
              <TextInput
                id="bulk-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Annual shelf audit"
              />
            </Field>
          </div>
          {error && (
            <p className="rounded-xl bg-[var(--rr-danger)]/10 p-3 text-xs text-[var(--rr-danger)]">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
