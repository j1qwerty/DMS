import { useEffect, useState } from 'react';
import {
  ArrowRight,
  DownloadSimple,
  Funnel,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  SortAscending,
  SortDescending,
  X,
} from '@phosphor-icons/react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { Button, LinkButton } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Field, SelectInput, TextInput } from '../components/ui/Field';
import { Pagination } from '../components/ui/Pagination';
import { StatusBadge } from '../components/ui/Flash';
import { EmptyState } from '../components/ui/EmptyState';
import { TableSkeleton } from '../components/ui/Skeletons';
import { FileRowActions } from '../components/files/FileRowActions';
import { BulkMoveModal } from '../components/files/BulkMoveModal';
import { useFileActions } from '../components/files/useFileActions';
import { useFlash, useQuery, useService, useSession } from '../hooks/useService';
import { useFeatures } from '../lib/features';
import { pushRecentSearch } from '../lib/recent';
import { downloadCsv, toCsv } from '../lib/csv';
import { cn } from '../lib/utils';
import type { FileStatus, FileType, RecordFile, RecordKind, Room } from '../types';
import type { FileQuery, Page } from '../services/contracts';

/**
 * Legacy collection size. The API reports its own figure via `collectionTotal`;
 * this is the fallback for the in-memory adapter, which has no honest number to
 * give and would otherwise imply it holds every record.
 */
const REGISTRY_TOTAL = 2_478_450;

const STATUSES: Array<FileStatus | 'All'> = [
  'All',
  'Available',
  'Issued',
  'Under Digitization',
  'Missing',
  'Archived',
];

const KIND_TABS: Array<{ value: RecordKind | 'All'; label: string }> = [
  { value: 'All', label: 'All records' },
  { value: 'File', label: 'Files' },
  { value: 'Map', label: 'Maps' },
];

const EMPTY: Page<RecordFile> = { items: [], total: 0, page: 1, pageSize: 10 };

/** Hideable registry columns (E5). File and Actions always render. */
type ColumnKey = 'type' | 'department' | 'status' | 'location';
const COLUMN_DEFS: Array<{ id: ColumnKey; label: string }> = [
  { id: 'type', label: 'Type' },
  { id: 'department', label: 'Department' },
  { id: 'status', label: 'Status' },
  { id: 'location', label: 'Location' },
];
const COLUMN_STORE_KEY = 'files.hidden-columns';

const loadHiddenColumns = (): Set<ColumnKey> => {
  try {
    const raw = window.localStorage.getItem(COLUMN_STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter(
            (id): id is ColumnKey =>
              typeof id === 'string' && COLUMN_DEFS.some((def) => def.id === id),
          )
        : [],
    );
  } catch {
    return new Set();
  }
};

const kindOf = (file: RecordFile): RecordKind =>
  file.recordKind ?? (file.documentSize === 'A0' || file.fileType === 'Map' ? 'Map' : 'File');

const DEFAULT_QUERY: FileQuery = {
  status: 'All',
  department: 'All',
  recordKind: 'All',
  fileType: 'All',
  eOfficeStatus: 'All',
  sort: 'fileNumber',
  direction: 'asc',
  page: 1,
  pageSize: 10,
};

export function FilesPage() {
  const service = useService();
  const { allowed } = useSession();
  const { success } = useFlash();
  const { barcode } = useFeatures();

  // Dashboard shortcuts link here with ?status=Missing or ?q=...
  const [params] = useSearchParams();
  const [query, setQuery] = useState<FileQuery>(() => {
    const status = params.get('status') as FileStatus | null;
    return {
      ...DEFAULT_QUERY,
      status: status && STATUSES.includes(status) ? status : 'All',
      search: params.get('q') ?? undefined,
    };
  });

  // E8: every registry search — from the topbar, the dashboard or the palette —
  // feeds the command palette's recent-searches list.
  const searched = params.get('q');
  useEffect(() => {
    pushRecentSearch(searched ?? '');
  }, [searched]);
  const [showFilters, setShowFilters] = useState(false);
  // Bulk selection (E4). Selection is page-local: it only matches ids the
  // current result actually shows, so paging or filtering implicitly prunes it.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMoving, setBulkMoving] = useState(false);
  const [editingEOfficeFile, setEditingEOfficeFile] = useState<RecordFile | null>(null);

  const toggleOne = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  // Column show/hide (E5), persisted per browser.
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnKey>>(loadHiddenColumns);
  const toggleColumn = (id: ColumnKey) =>
    setHiddenColumns((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(COLUMN_STORE_KEY, JSON.stringify([...next]));
      } catch {
        // Private mode: the choice just does not survive a reload.
      }
      return next;
    });

  const {
    data: result,
    loading,
    reload,
  } = useQuery(
    () => service.files.list(query),
    [query],
    EMPTY,
    // Another desk registering or relocating a file changes this list.
    ['files', 'issues'],
  );
  const { data: departments } = useQuery(() => service.files.departments(), [], [] as string[]);
  const { data: rooms } = useQuery(() => service.locations.listRooms(), [], [] as Room[]);

  const selectedRows = result.items.filter((file) => selected.has(file.id));
  const allOnPageSelected = result.items.length > 0 && selectedRows.length === result.items.length;

  const togglePage = () => {
    if (allOnPageSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(result.items.map((file) => file.id)));
    }
  };

  const { open, dialogs } = useFileActions((message) => {
    success(message);
    reload();
  });

  const sectionOptions = rooms
    .flatMap((room) => room.sections)
    .filter((section) => !query.roomId || section.roomId === query.roomId);
  const shelfOptions = rooms
    .flatMap((room) => room.storageUnits)
    .filter(
      (unit) =>
        (!query.roomId || unit.roomId === query.roomId) &&
        (!query.sectionId || unit.sectionId === query.sectionId),
    )
    .flatMap((unit) => {
      const room = rooms.find((item) => item.id === unit.roomId);
      const section = room?.sections.find((item) => item.id === unit.sectionId);
      return unit.shelves.map((shelf) => ({
        id: shelf.id,
        label: [room?.code, section?.code, unit.code, shelf.code].filter(Boolean).join(' / '),
      }));
    });

  const collectionTotal = result.collectionTotal ?? REGISTRY_TOTAL;

  const patch = (next: Partial<FileQuery>) => {
    // A new query means new rows; page-local selection would go stale.
    setSelected(new Set());
    setQuery((current) => ({ ...current, ...next, page: next.page ?? 1 }));
  };

  const activeFilters = [
    query.department !== 'All',
    query.fileType !== 'All',
    query.eOfficeStatus !== 'All',
    Boolean(query.roomId),
    Boolean(query.sectionId),
    Boolean(query.shelfId),
  ].filter(Boolean).length;
  const anythingSet =
    activeFilters > 0 ||
    Boolean(query.search) ||
    query.status !== 'All' ||
    query.recordKind !== 'All';

  const clearAll = () => {
    setSelected(new Set());
    setQuery((current) => ({ ...DEFAULT_QUERY, pageSize: current.pageSize }));
  };

  const exportCsv = (files: RecordFile[], fileNameSuffix: string) => {
    const columns = [
      'Barcode',
      'Number',
      'Subject',
      'Department',
      'Year',
      'Status',
      'Record kind',
      'Document size',
      'Type',
      'E-office reference',
      'E-office linked',
      'Room',
      'Section',
      'Almirah',
      'Shelf',
      'Shelf barcode',
      'Last movement',
    ];
    const rows = files.map((file) => [
      file.fileBarcode,
      file.fileNumber,
      file.subject,
      file.department,
      file.year,
      file.status,
      kindOf(file),
      file.documentSize ?? 'Other',
      file.fileType,
      file.eOfficeReference ?? '',
      file.eOfficeReference?.trim() ? 'Yes' : 'No',
      file.location,
      file.section,
      file.almirah,
      file.shelf,
      file.shelfBarcode,
      file.lastMovement,
    ]);
    // Barcode columns (0 and 15) are dropped when barcode features are off.
    const keep = (_: unknown, index: number) => barcode || (index !== 0 && index !== 15);
    downloadCsv(
      `documents-${fileNameSuffix}.csv`,
      toCsv(
        columns.filter(keep),
        rows.map((row) => row.filter(keep)),
      ),
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Documents"
        description="Find a document, open its scan or map, and see where the physical file is kept."
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => exportCsv(result.items, new Date().toISOString().slice(0, 10))}
              icon={<DownloadSimple size={17} />}
            >
              <span className="hidden sm:inline">Export this page</span>
              <span className="sm:hidden">Export</span>
            </Button>
            {/* Round 4: the bulk-import entry is hidden everywhere; the page
                itself stays reachable by URL behind files.bulkImport. */}
            {allowed('files.create') && (
              <LinkButton to="/files/new" icon={<Plus size={17} weight="bold" />}>
                Register file
              </LinkButton>
            )}
          </>
        }
      />

      <Card padding={false} className="overflow-hidden">
        {/* Record kind tabs */}
        <div
          role="tablist"
          aria-label="Record kind"
          className="flex gap-1 border-b border-base px-3 pt-2 sm:px-4"
        >
          {KIND_TABS.map((tab) => {
            const active = (query.recordKind ?? 'All') === tab.value;
            return (
              <button
                key={tab.value}
                role="tab"
                aria-selected={active}
                onClick={() => patch({ recordKind: tab.value })}
                className={cn(
                  'focus-ring -mb-px min-h-11 rounded-t-lg border-b-2 px-4 text-sm font-semibold transition',
                  active
                    ? 'border-[var(--rr-accent)] text-accent'
                    : 'muted border-transparent hover:text-[var(--rr-text)]',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Search + filters */}
        <div className="space-y-3 border-b border-base p-3 sm:p-4">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <MagnifyingGlass
                className="muted pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
                size={18}
              />
              <input
                type="search"
                value={query.search ?? ''}
                onChange={(event) => patch({ search: event.target.value })}
                placeholder={barcode ? 'File number, barcode or subject' : 'File number or subject'}
                aria-label="Search documents"
                className="focus-ring h-11 w-full rounded-lg border border-base bg-[var(--rr-surface)] pl-10 pr-3 text-base outline-none placeholder:text-[var(--rr-muted)] sm:text-sm"
              />
            </div>
            <Button
              variant="ghost"
              onClick={() => setShowFilters((value) => !value)}
              aria-expanded={showFilters}
              className="h-11 shrink-0"
              icon={<Funnel size={17} />}
            >
              <span className="hidden sm:inline">Filters</span>
              {activeFilters > 0 && (
                <span className="grid size-5 place-items-center rounded-full bg-[var(--rr-accent-fill)] text-[11px] text-white">
                  {activeFilters}
                </span>
              )}
            </Button>
          </div>

          <div
            role="group"
            aria-label="Filter by status"
            className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:flex-wrap sm:px-0"
          >
            {STATUSES.map((item) => {
              const active = (query.status ?? 'All') === item;
              return (
                <button
                  key={item}
                  onClick={() => patch({ status: item })}
                  aria-pressed={active}
                  className={cn(
                    'focus-ring min-h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold transition',
                    active
                      ? 'border-[var(--rr-accent-fill)] bg-[var(--rr-accent-fill)] text-white'
                      : 'border-base bg-[var(--rr-surface)] hover:bg-[var(--rr-surface-2)]',
                  )}
                >
                  {item === 'All' ? 'Any status' : item}
                </button>
              );
            })}
          </div>

          {showFilters && (
            <div className="rounded-xl border border-base bg-[var(--rr-bg)] p-3.5 sm:p-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Field label="Department" htmlFor="f-dept">
                  <SelectInput
                    id="f-dept"
                    value={query.department ?? 'All'}
                    onChange={(event) => patch({ department: event.target.value })}
                  >
                    <option value="All">All departments</option>
                    {departments.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label="Document type" htmlFor="f-type">
                  <SelectInput
                    id="f-type"
                    value={query.fileType ?? 'All'}
                    onChange={(event) =>
                      patch({ fileType: event.target.value as FileType | 'All' })
                    }
                  >
                    <option value="All">All types</option>
                    {(['Letter', 'File', 'Register', 'Map', 'Drawing', 'Report'] as FileType[]).map(
                      (type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ),
                    )}
                  </SelectInput>
                </Field>
                <Field label="E-office" htmlFor="f-eoffice">
                  <SelectInput
                    id="f-eoffice"
                    value={query.eOfficeStatus ?? 'All'}
                    onChange={(event) =>
                      patch({ eOfficeStatus: event.target.value as FileQuery['eOfficeStatus'] })
                    }
                  >
                    <option value="All">Linked or not</option>
                    <option value="Linked">Linked to e-office</option>
                    <option value="Not linked">Not linked</option>
                  </SelectInput>
                </Field>
                <Field label="Sort by" htmlFor="f-sort">
                  <div className="flex gap-2">
                    <SelectInput
                      id="f-sort"
                      value={query.sort ?? 'fileNumber'}
                      onChange={(event) => patch({ sort: event.target.value as FileQuery['sort'] })}
                      className="min-w-0 flex-1"
                    >
                      <option value="fileNumber">File number</option>
                      <option value="subject">Subject</option>
                      <option value="year">Year</option>
                      <option value="department">Department</option>
                      <option value="lastMovement">Last movement</option>
                      <option value="shelf">Shelf</option>
                    </SelectInput>
                    <Button
                      variant="ghost"
                      className="size-11 shrink-0 !px-0"
                      onClick={() =>
                        patch({ direction: query.direction === 'asc' ? 'desc' : 'asc' })
                      }
                      aria-label={`Sorted ${query.direction === 'asc' ? 'ascending' : 'descending'}. Switch order`}
                      title={query.direction === 'asc' ? 'Ascending' : 'Descending'}
                      icon={
                        query.direction === 'asc' ? (
                          <SortAscending size={18} />
                        ) : (
                          <SortDescending size={18} />
                        )
                      }
                    />
                  </div>
                </Field>
                <Field label="Room" htmlFor="f-room">
                  <SelectInput
                    id="f-room"
                    value={query.roomId ?? ''}
                    onChange={(event) =>
                      patch({
                        roomId: event.target.value || undefined,
                        sectionId: undefined,
                        shelfId: undefined,
                      })
                    }
                  >
                    <option value="">All rooms</option>
                    {rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.code} — {room.name}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label="Section" htmlFor="f-section">
                  <SelectInput
                    id="f-section"
                    value={query.sectionId ?? ''}
                    onChange={(event) =>
                      patch({ sectionId: event.target.value || undefined, shelfId: undefined })
                    }
                    disabled={!query.roomId}
                  >
                    <option value="">{query.roomId ? 'All sections' : 'Pick a room first'}</option>
                    {sectionOptions.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.code} — {section.name}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label="Shelf" htmlFor="f-shelf" className="sm:col-span-2">
                  <SelectInput
                    id="f-shelf"
                    value={query.shelfId ?? ''}
                    onChange={(event) => patch({ shelfId: event.target.value || undefined })}
                    disabled={!query.sectionId}
                  >
                    <option value="">
                      {query.sectionId ? 'All shelves' : 'Pick a section first'}
                    </option>
                    {shelfOptions.map((shelf) => (
                      <option key={shelf.id} value={shelf.id}>
                        {shelf.label}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
              </div>
            </div>
          )}

          {anythingSet && (
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <p className="muted">
                {loading ? 'Searching…' : `${result.total.toLocaleString('en-IN')} matching`}
              </p>
              <button
                onClick={clearAll}
                className="focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 font-semibold text-accent hover:bg-accent-soft"
              >
                <X size={14} weight="bold" /> Clear all
              </button>
            </div>
          )}
        </div>

        {selectedRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-base bg-accent-soft px-3 py-2.5 sm:px-4">
            <p className="text-sm font-semibold">
              {selectedRows.length} selected
              {selectedRows.length < result.items.length && (
                <span className="muted font-normal"> of this page</span>
              )}
            </p>
            {allowed('files.edit') && (
              <Button
                variant="ghost"
                onClick={() => setBulkMoving(true)}
                icon={<ArrowRight size={16} />}
              >
                Relocate…
              </Button>
            )}
            <Button
              variant="ghost"
              icon={<DownloadSimple size={16} />}
              onClick={() => {
                exportCsv(selectedRows, 'selected');
                setSelected(new Set());
              }}
            >
              Export selected
            </Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}

        {loading && result.items.length === 0 ? (
          <div className="p-4 sm:p-6">
            <TableSkeleton rows={10} columns={[1.7, 1.5, 3, 1.3, 0.8, 1.2]} />
          </div>
        ) : result.items.length === 0 ? (
          <div className="p-4 sm:p-6">
            <EmptyState
              title="No files match"
              description="Try fewer words, or clear a filter. The registry holds far more rows than one page shows."
              action={
                anythingSet ? (
                  <Button variant="ghost" onClick={clearAll}>
                    Clear all filters
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden lg:block">
              <div className="flex items-center justify-end border-b border-base px-4 py-2">
                <details className="relative">
                  <summary className="focus-ring inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-accent hover:bg-accent-soft [&::-webkit-details-marker]:hidden">
                    Columns
                  </summary>
                  <div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-base bg-[var(--rr-surface)] p-3 shadow-lg">
                    {COLUMN_DEFS.map((def) => (
                      <label
                        key={def.id}
                        className="flex cursor-pointer items-center gap-2 py-1 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={!hiddenColumns.has(def.id)}
                          onChange={() => toggleColumn(def.id)}
                          className="size-3.5 accent-[var(--rr-accent)]"
                        />
                        {def.label}
                      </label>
                    ))}
                  </div>
                </details>
              </div>
              <div className="max-h-[65vh] overflow-auto">
                <table className="w-full min-w-[1040px] text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-[var(--rr-bg)] text-[13px] muted">
                    <tr>
                      <th className="w-10 px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label="Select every row on this page"
                          checked={allOnPageSelected}
                          onChange={togglePage}
                          className="size-4 accent-[var(--rr-accent)]"
                        />
                      </th>
                      <th className="px-4 py-3 font-semibold">File</th>
                      {!hiddenColumns.has('type') && (
                        <th className="px-4 py-3 font-semibold">Type</th>
                      )}
                      {!hiddenColumns.has('department') && (
                        <th className="px-4 py-3 font-semibold">Department</th>
                      )}
                      {!hiddenColumns.has('status') && (
                        <th className="px-4 py-3 font-semibold">Status</th>
                      )}
                      {!hiddenColumns.has('location') && (
                        <th className="px-4 py-3 font-semibold">Location</th>
                      )}
                      <th className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--rr-border)]">
                    {result.items.map((file) => {
                      const kind = kindOf(file);
                      return (
                        <tr key={file.id} className="align-top hover:bg-[var(--rr-bg)]">
                          <td className="px-3 py-3.5">
                            <input
                              type="checkbox"
                              aria-label={`Select ${file.fileNumber}`}
                              checked={selected.has(file.id)}
                              onChange={(event) => toggleOne(file.id, event.target.checked)}
                              className="mt-1 size-4 accent-[var(--rr-accent)]"
                            />
                          </td>
                          <td className="max-w-[300px] px-4 py-3.5">
                            <Link
                              to={`/files/${file.id}`}
                              className="focus-ring mono rounded font-semibold text-accent hover:underline"
                            >
                              {file.fileNumber}
                            </Link>
                            <p className="mt-1 line-clamp-2 text-[13px] leading-5">
                              {file.subject}
                            </p>
                            {barcode && (
                              <p className="mono muted mt-1 text-xs">{file.fileBarcode}</p>
                            )}
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              {file.eOfficeReference?.trim() ? (
                                <span className="inline-flex items-center gap-1 rounded bg-[var(--rr-surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--rr-text)]">
                                  <span className="muted font-sans text-[10px]">e-office:</span>{' '}
                                  {file.eOfficeReference}
                                  {allowed('files.edit') && (
                                    <button
                                      type="button"
                                      onClick={() => setEditingEOfficeFile(file)}
                                      className="focus-ring ml-0.5 text-accent hover:underline"
                                      title="Edit e-office reference"
                                      aria-label="Edit e-office reference"
                                    >
                                      <PencilSimple size={12} />
                                    </button>
                                  )}
                                </span>
                              ) : (
                                allowed('files.edit') && (
                                  <button
                                    type="button"
                                    onClick={() => setEditingEOfficeFile(file)}
                                    className="focus-ring inline-flex items-center gap-1 rounded border border-dashed border-base px-1.5 py-0.5 text-[11px] font-medium text-accent hover:bg-accent-soft"
                                    title="Link e-office reference"
                                  >
                                    <Plus size={11} /> e-Office ref
                                  </button>
                                )
                              )}
                            </div>
                          </td>
                          {!hiddenColumns.has('type') && (
                            <td className="px-4 py-3.5">
                              <Badge tone={kind === 'Map' ? 'info' : 'neutral'}>{kind}</Badge>
                              <p className="muted mt-1.5 text-xs">
                                {file.fileType}
                                {file.documentSize ? ` · ${file.documentSize}` : ''}
                              </p>
                            </td>
                          )}
                          {!hiddenColumns.has('department') && (
                            <td className="px-4 py-3.5">
                              <p className="text-[13px]">{file.department}</p>
                              <p className="muted mt-0.5 text-xs">{file.year}</p>
                            </td>
                          )}
                          {!hiddenColumns.has('status') && (
                            <td className="px-4 py-3.5">
                              <StatusBadge status={file.status} />
                              {file.status === 'Issued' && file.holder && (
                                <p className="muted mt-1.5 max-w-[140px] text-xs">
                                  with {file.holder}
                                </p>
                              )}
                            </td>
                          )}
                          {!hiddenColumns.has('location') && (
                            <td className="max-w-[220px] px-4 py-3.5">
                              <p className="text-[13px] leading-5">{file.location}</p>
                              <p className="muted mt-0.5 text-xs">Moved {file.lastMovement}</p>
                            </td>
                          )}
                          <td className="px-4 py-3">
                            <FileRowActions file={file} onAction={open} variant="icons" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Phone & tablet cards */}
            <ul className="divide-y divide-[var(--rr-border)] lg:hidden">
              {result.items.map((file) => {
                const kind = kindOf(file);
                return (
                  <li key={file.id} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Select ${file.fileNumber}`}
                          checked={selected.has(file.id)}
                          onChange={(event) => toggleOne(file.id, event.target.checked)}
                          className="mt-1 size-4 shrink-0 accent-[var(--rr-accent)]"
                        />
                        <div className="min-w-0">
                          <Link
                            to={`/files/${file.id}`}
                            className="focus-ring mono rounded text-[15px] font-semibold text-accent"
                          >
                            {file.fileNumber}
                          </Link>
                          {barcode && (
                            <p className="mono muted mt-0.5 text-xs">{file.fileBarcode}</p>
                          )}
                        </div>
                      </div>
                      <StatusBadge status={file.status} />
                    </div>
                    <p className="text-sm leading-5">{file.subject}</p>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                      <div>
                        <dt className="muted text-xs">Type</dt>
                        <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <Badge tone={kind === 'Map' ? 'info' : 'neutral'}>{kind}</Badge>
                          <span className="muted text-xs">{file.fileType}</span>
                        </dd>
                      </div>
                      <div>
                        <dt className="muted text-xs">Department · year</dt>
                        <dd className="mt-0.5">
                          {file.department} · {file.year}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="muted text-xs">Shelved at</dt>
                        <dd className="mt-0.5">{file.location}</dd>
                      </div>
                      {file.status === 'Issued' && file.holder && (
                        <div className="col-span-2">
                          <dt className="muted text-xs">Held by</dt>
                          <dd className="mt-0.5">{file.holder}</dd>
                        </div>
                      )}
                    </dl>
                    <FileRowActions file={file} onAction={open} variant="labeled" />
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <Pagination
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          collectionTotal={collectionTotal}
          onPage={(page) => patch({ page })}
          onPageSize={(pageSize) => patch({ pageSize })}
          label="files"
        />
      </Card>

      {dialogs}
      <EOfficeModal
        key={editingEOfficeFile?.id ?? 'none'}
        file={editingEOfficeFile}
        onClose={() => setEditingEOfficeFile(null)}
        onSaved={reload}
      />
      {bulkMoving && selectedRows.length > 0 && (
        <BulkMoveModal
          files={selectedRows}
          onClose={() => setBulkMoving(false)}
          onDone={(message) => {
            setBulkMoving(false);
            setSelected(new Set());
            success(message);
            reload();
          }}
        />
      )}
    </div>
  );
}

function EOfficeModal({
  file,
  onClose,
  onSaved,
}: {
  file: RecordFile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // The call site keys this modal by file id, so the state initializer runs
  // per file and no syncing effect is needed.
  const [draft, setDraft] = useState(file?.eOfficeReference ?? '');
  const [saving, setSaving] = useState(false);
  const service = useService();
  const { success, danger } = useFlash();

  if (!file) return null;

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`E-office Reference — ${file.fileNumber}`}
      description="Enter or update the e-office file name or identifier to link this record."
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            const res = await service.files.updateEOfficeReference(file.id, draft.trim());
            if (res.ok) {
              success(
                res.value.eOfficeReference
                  ? 'E-office reference saved.'
                  : 'E-office reference cleared.',
              );
              onClose();
              onSaved();
            } else {
              danger(res.error);
            }
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field
          label="E-office file name / ID"
          htmlFor="eoffice-modal-ref"
          hint="Clear the field to remove the link."
        >
          <TextInput
            id="eoffice-modal-ref"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. EOFFICE/REV/2026/00123"
            autoFocus
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save reference'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
