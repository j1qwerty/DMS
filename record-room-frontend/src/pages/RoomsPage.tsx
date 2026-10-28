import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Buildings,
  PencilSimple,
  Plus,
  SquaresFour,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react';
import { PageHeader } from '../components/ui/PageHeader';
import { Button, LinkButton } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Field, SelectInput, TextInput } from '../components/ui/Field';
import { Flash } from '../components/ui/Flash';
import { EmptyState } from '../components/ui/EmptyState';
import { Badge } from '../components/ui/Badge';
import { Spine } from '../components/ShelfSpines';
import { useFlash, useQuery, useService, useSession } from '../hooks/useService';
import type { Room } from '../types';
import type { RoomInput } from '../services/contracts';

const EMPTY_ROOMS: Room[] = [];
const STATUSES: Room['status'][] = ['Operational', 'Restricted', 'Maintenance'];

function fillOf(room: Room) {
  const shelves = room.storageUnits.flatMap((unit) => unit.shelves);
  const capacity = shelves.reduce((sum, shelf) => sum + shelf.capacity, 0);
  const used = shelves.reduce((sum, shelf) => sum + shelf.occupied, 0);
  return capacity > 0 ? used / capacity : 0;
}

function shelfCount(room: Room) {
  return room.storageUnits.reduce((sum, unit) => sum + unit.shelves.length, 0);
}

/** Rooms: see them all, add one, edit one, remove an empty one. */
export function RoomsPage() {
  const service = useService();
  const { allowed } = useSession();
  const { flash, success, clear } = useFlash();
  const canEdit = allowed('locations.edit');

  const [editing, setEditing] = useState<Room | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Room | null>(null);

  const {
    data: rooms,
    loading,
    reload,
  } = useQuery(() => service.locations.listRooms(), [], EMPTY_ROOMS, ['locations', 'files']);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Record rooms"
        description="Every room in the registry. Add a room here, then set up its sections, almirahs and shelves in Room layout."
        actions={
          <>
            {allowed('locations.view') && (
              <LinkButton to="/admin/locations" variant="ghost" icon={<SquaresFour size={17} />}>
                Room layout
              </LinkButton>
            )}
            {canEdit && (
              <Button onClick={() => setEditing('new')} icon={<Plus size={17} weight="bold" />}>
                Add room
              </Button>
            )}
          </>
        }
      />

      {flash && <Flash tone={flash.tone} text={flash.text} onDismiss={clear} />}

      {rooms.length === 0 ? (
        <EmptyState
          title={loading ? 'Loading rooms' : 'No rooms yet'}
          description={
            loading
              ? 'Fetching the room list.'
              : canEdit
                ? 'Add your first record room to start placing files on shelves.'
                : 'Ask an administrator to add a room.'
          }
          action={
            !loading && canEdit ? (
              <Button onClick={() => setEditing('new')} icon={<Plus size={17} />}>
                Add room
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rooms.map((room) => {
            const fill = fillOf(room);
            return (
              <li key={room.id}>
                <Card padding={false} className="flex h-full flex-col">
                  <div className="flex items-start justify-between gap-3 p-4 pb-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Buildings size={18} className="shrink-0 text-accent" />
                        <h2 className="truncate text-base font-bold">{room.name}</h2>
                      </div>
                      <p className="muted mt-1 text-[13px]">
                        <span className="mono text-xs">{room.code}</span> ·{' '}
                        {room.building || 'No building'}
                        {room.floor && ` · ${room.floor}`}
                      </p>
                    </div>
                    <Badge tone={room.status === 'Operational' ? 'success' : 'warning'}>
                      {room.status}
                    </Badge>
                  </div>

                  <div className="px-4">
                    <div className="flex items-baseline justify-between text-[13px]">
                      <span className="muted">Shelf space used</span>
                      <span className="font-semibold">{Math.round(fill * 100)}%</span>
                    </div>
                    <div
                      className="mt-2 flex h-10 items-end gap-1"
                      role="img"
                      aria-label={`${room.storageUnits.length} almirahs, ${Math.round(fill * 100)} percent full`}
                    >
                      {room.storageUnits.length === 0 ? (
                        <p className="muted self-center text-xs">No almirahs set up yet</p>
                      ) : (
                        room.storageUnits.map((unit) => {
                          const cap = unit.shelves.reduce((sum, shelf) => sum + shelf.capacity, 0);
                          const used = unit.shelves.reduce((sum, shelf) => sum + shelf.occupied, 0);
                          return (
                            <div key={unit.id} className="flex h-full max-w-4 flex-1 items-end">
                              <Spine
                                fill={cap > 0 ? used / cap : 0}
                                title={`${unit.code}: ${cap > 0 ? Math.round((used / cap) * 100) : 0}% full`}
                              />
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <dl className="mt-4 grid grid-cols-3 divide-x divide-[var(--rr-border)] border-t border-base text-center">
                    {[
                      ['Sections', room.sections.length],
                      ['Almirahs', room.storageUnits.length],
                      ['Shelves', shelfCount(room)],
                    ].map(([label, value]) => (
                      <div key={label} className="py-3">
                        <dd className="text-base font-bold">{value}</dd>
                        <dt className="muted text-xs">{label}</dt>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-auto flex items-center gap-2 border-t border-base p-3">
                    <Link
                      to={`/rooms/${room.id}`}
                      className="focus-ring inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--rr-accent)] px-3 text-sm font-semibold text-white hover:bg-[var(--rr-accent-strong)] dark:text-[#0d1420]"
                    >
                      Open room <ArrowRight size={15} weight="bold" />
                    </Link>
                    {canEdit && (
                      <>
                        <Button
                          variant="ghost"
                          className="size-10 !px-0"
                          onClick={() => setEditing(room)}
                          aria-label={`Edit ${room.name}`}
                          title="Edit room"
                          icon={<PencilSimple size={17} />}
                        />
                        <Button
                          variant="ghost"
                          className="size-10 !px-0 text-[var(--rr-danger)]"
                          onClick={() => setDeleting(room)}
                          aria-label={`Delete ${room.name}`}
                          title="Delete room"
                          icon={<Trash size={17} />}
                        />
                      </>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <RoomFormModal
          room={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            success(message);
            reload();
          }}
        />
      )}

      {deleting && (
        <DeleteRoomModal
          room={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(message) => {
            setDeleting(null);
            success(message);
            reload();
          }}
        />
      )}
    </div>
  );
}

function RoomFormModal({
  room,
  onClose,
  onSaved,
}: {
  room: Room | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const service = useService();
  const [name, setName] = useState(room?.name ?? '');
  const [building, setBuilding] = useState(room?.building ?? '');
  const [floor, setFloor] = useState(room?.floor ?? '');
  const [status, setStatus] = useState<Room['status']>(room?.status ?? 'Operational');
  const [capacity, setCapacity] = useState(room?.capacity ?? 100);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return setError({ text: 'Give the room a name.', field: 'name' });
    const input: RoomInput = { name, building, floor, status, capacity };
    setBusy(true);
    setError(null);
    try {
      const result = room
        ? await service.locations.updateRoom(room.id, input)
        : await service.locations.addRoom(input);
      if (!result.ok) return setError({ text: result.error, field: result.field });
      onSaved(
        room
          ? `${result.value.name} updated.`
          : `${result.value.name} added as ${result.value.code}.`,
      );
    } catch (cause) {
      setError({ text: cause instanceof Error ? cause.message : 'Could not save the room.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={room ? `Edit ${room.name}` : 'Add a room'}
      description={
        room
          ? `Code ${room.code} stays the same.`
          : 'A room code is created for you. Add its almirahs and shelves afterwards in Room layout.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : room ? 'Save changes' : 'Add room'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label="Room name"
          htmlFor="room-name"
          required
          error={error?.field === 'name' ? error.text : undefined}
        >
          <TextInput
            id="room-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Record Room 04"
            invalid={error?.field === 'name'}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Building" htmlFor="room-building">
            <TextInput
              id="room-building"
              value={building}
              onChange={(event) => setBuilding(event.target.value)}
              placeholder="e.g. Main office"
            />
          </Field>
          <Field label="Floor" htmlFor="room-floor">
            <TextInput
              id="room-floor"
              value={floor}
              onChange={(event) => setFloor(event.target.value)}
              placeholder="e.g. Ground floor"
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" htmlFor="room-status">
            <SelectInput
              id="room-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as Room['status'])}
            >
              {STATUSES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field
            label="Planned capacity"
            htmlFor="room-capacity"
            hint="Roughly how many files it can hold."
          >
            <TextInput
              id="room-capacity"
              type="number"
              inputMode="numeric"
              min={1}
              value={capacity}
              onChange={(event) => setCapacity(Number(event.target.value))}
            />
          </Field>
        </div>
        {error && !error.field && (
          <p role="alert" className="text-sm text-[var(--rr-danger)]">
            {error.text}
          </p>
        )}
        {/* Lets Enter submit from any field. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

function DeleteRoomModal({
  room,
  onClose,
  onDeleted,
}: {
  room: Room;
  onClose: () => void;
  onDeleted: (message: string) => void;
}) {
  const service = useService();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasContents = room.sections.length > 0 || room.storageUnits.length > 0;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await service.locations.deleteRoom(room.id);
      if (!result.ok) return setError(result.error);
      onDeleted(`${room.name} was removed.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove the room.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete ${room.name}?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Keep room
          </Button>
          <Button variant="danger" onClick={confirm} disabled={busy || hasContents}>
            {busy ? 'Deleting…' : 'Delete room'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm leading-6">
        {hasContents ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-[color-mix(in_srgb,var(--rr-warning)_50%,transparent)] bg-[color-mix(in_srgb,var(--rr-warning)_8%,transparent)] p-3">
            <WarningCircle
              size={18}
              weight="fill"
              className="mt-0.5 shrink-0 text-[var(--rr-warning)]"
            />
            <p>
              This room still has {room.sections.length} section(s) and {room.storageUnits.length}{' '}
              almirah(s). Remove those in{' '}
              <Link to="/admin/locations" className="font-semibold text-accent underline">
                Room layout
              </Link>{' '}
              first, then delete the room.
            </p>
          </div>
        ) : (
          <p>
            <strong>{room.code}</strong> will be removed from the registry. This can’t be undone.
            Rooms that still have files recorded in them can’t be deleted.
          </p>
        )}
        {error && (
          <p role="alert" className="text-[var(--rr-danger)]">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
