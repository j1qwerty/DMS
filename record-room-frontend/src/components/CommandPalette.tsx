import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ClockCounterClockwise,
  MagnifyingGlass,
  SquaresFour,
} from '@phosphor-icons/react';
import { Modal } from './ui/Modal';
import { StatusBadge } from './ui/Flash';
import { useQuery, useService } from '../hooks/useService';
import { useFeatures } from '../lib/features';
import {
  getRecentFiles,
  getRecentSearches,
  pushRecentSearch,
  type RecentFile,
} from '../lib/recent';
import type { Permission } from '../services/permissions';
import type { RecordFile } from '../types';

const EMPTY_PAGE = { items: [] as RecordFile[], total: 0, page: 1, pageSize: 8 };

type Item =
  | { key: string; kind: 'file'; file: RecordFile; context: string }
  | { key: string; kind: 'search'; term: string }
  | { key: string; kind: 'nav'; label: string; to: string };

/** Destinations the palette can jump to; filtered by role and features at render. */
const COMMANDS: Array<{ label: string; to: string; permission?: Permission; feature?: 'barcode' }> =
  [
    { label: 'Registry', to: '/files' },
    { label: 'Search the registry', to: '/search' },
    // { label: 'Overview dashboard', to: '/overview' }, — Overview hidden (round 6)
    { label: 'Issue desk', to: '/issue' },
    { label: 'Return desk', to: '/return' },
    { label: 'Movement log', to: '/movement' },
    { label: 'Digitization worklist', to: '/digitization' },
    { label: 'Review queue', to: '/review', permission: 'digitization.view' },
    { label: 'Reports', to: '/reports' },
    { label: 'Locations', to: '/rooms' },
    { label: 'Barcodes', to: '/barcodes', feature: 'barcode' },
    { label: 'Scan desk', to: '/scan', feature: 'barcode' },
    { label: 'Maps', to: '/maps', permission: 'files.view' },
    { label: 'Employees', to: '/admin/employees', permission: 'employees.view' },
    { label: 'Locations designer', to: '/admin/locations', permission: 'locations.view' },
    { label: 'Logins', to: '/admin/users', permission: 'users.view' },
    { label: 'Audit trail', to: '/admin/audit', permission: 'audit.view' },
    { label: 'Settings', to: '/settings' },
    { label: 'Support', to: '/support' },
  ];

/** Names every metadata field the query matched, so the row explains itself. */
function matchContext(file: RecordFile, term: string): string {
  const q = term.toLowerCase();
  const fields: Array<[string, string | undefined]> = [
    ['barcode', file.fileBarcode],
    ['file number', file.fileNumber],
    ['subject', file.subject],
    ['location', file.location],
    ['e-office', file.eOfficeReference],
    ['department', file.department],
  ];
  const hits = fields.filter(([, value]) => value?.toLowerCase().includes(q)).map(([name]) => name);
  return hits.length ? `Matched ${hits.join(' · ')}` : 'Matched record';
}

/**
 * The command palette (E8): one overlay that finds files, replays recent
 * searches and recent files, and jumps to any page the role allows.
 *
 * Opened with `/` or Ctrl/Cmd+K from the Topbar. File results come from the
 * same service search the registry uses, so permissions and guards stay in the
 * service layer; each row shows which metadata field matched (match context).
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const service = useService();
  const { barcode } = useFeatures();
  const [term, setTerm] = useState('');
  const [deferred, setDeferred] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // The modal grabs focus for its focus trap; reclaim it for the input.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Debounce so a burst of keystrokes costs one service call, not one per key.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setDeferred(term.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [term, open]);

  const searching = deferred.length >= 2;
  const { data: page } = useQuery(
    () =>
      searching
        ? service.files.list({ search: deferred, pageSize: 8 })
        : Promise.resolve(EMPTY_PAGE),
    [deferred, searching],
    EMPTY_PAGE,
  );

  const recentFiles = useMemo(() => (open ? getRecentFiles() : []), [open]);
  const recentSearches = useMemo(() => (open ? getRecentSearches() : []), [open]);

  const items = useMemo<Item[]>(() => {
    const needle = deferred.toLowerCase();
    const commands = COMMANDS.filter(
      (command) =>
        (!command.feature || (command.feature === 'barcode' && barcode)) &&
        (!searching || command.label.toLowerCase().includes(needle)),
    ).map((command) => ({
      key: `nav:${command.to}`,
      kind: 'nav' as const,
      label: command.label,
      to: command.to,
    }));
    const files = page.items.map<Item>((file) => ({
      key: `file:${file.id}`,
      kind: 'file',
      file,
      context: matchContext(file, deferred),
    }));
    const searches = recentSearches
      .filter((term_) => !searching || term_.toLowerCase().includes(needle))
      .slice(0, 4)
      .map<Item>((term_) => ({ key: `search:${term_}`, kind: 'search', term: term_ }));
    if (searching) return [...files, ...searches, ...commands];
    const recents = recentFiles.map<Item>((recent: RecentFile) => ({
      key: `recent:${recent.id}`,
      kind: 'file',
      file: {
        id: recent.id,
        fileBarcode: recent.ref,
        rfId: recent.ref,
        fileNumber: recent.ref,
        subject: recent.subject,
        status: recent.status,
      } as RecordFile,
      context: 'Opened recently',
    }));
    return [...recents, ...searches, ...commands];
  }, [page.items, recentSearches, recentFiles, deferred, searching, barcode]);

  // Keep the highlight inside the list when results shrink under the cursor.
  const activeIndex = Math.min(active, Math.max(items.length - 1, 0));

  const run = (item: Item | undefined) => {
    if (!item) {
      // Nothing matched: the typed term still becomes a registry search.
      if (searching) {
        pushRecentSearch(deferred);
        navigate(`/files?q=${encodeURIComponent(deferred)}`);
        onClose();
      }
      return;
    }
    if (item.kind === 'file') {
      navigate(`/files/${item.file.id}`);
    } else if (item.kind === 'search') {
      pushRecentSearch(item.term);
      navigate(`/files?q=${encodeURIComponent(item.term)}`);
    } else {
      navigate(item.to);
    }
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(Math.min(activeIndex + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(items[activeIndex]);
    } else if (event.key !== 'Escape' && event.key !== 'Tab') {
      setActive(0);
    }
  };

  const row = (item: Item, index: number, section: string) => {
    const highlighted = index === activeIndex;
    const select = () => run(item);
    const shell =
      'focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm';
    const tone = highlighted ? 'bg-[var(--rr-surface-2)]' : 'hover:bg-[var(--rr-surface-2)]';
    return (
      <li key={item.key} aria-label={section}>
        {item.kind === 'file' ? (
          <button type="button" onClick={select} className={`${shell} ${tone}`}>
            <MagnifyingGlass size={16} className="muted shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold text-accent">
                  {barcode ? item.file.fileBarcode : item.file.fileNumber || item.file.rfId}
                </span>
                <StatusBadge status={item.file.status} />
              </span>
              <span className="mt-0.5 block truncate font-medium">{item.file.subject}</span>
              <span className="muted mt-0.5 block text-xs">{item.context}</span>
            </span>
            <ArrowRight size={14} className="muted shrink-0" />
          </button>
        ) : item.kind === 'search' ? (
          <button type="button" onClick={select} className={`${shell} ${tone}`}>
            <ClockCounterClockwise size={16} className="muted shrink-0" />
            <span className="min-w-0 flex-1 truncate">{item.term}</span>
            <span className="muted shrink-0 text-xs">Recent search</span>
          </button>
        ) : (
          <button type="button" onClick={select} className={`${shell} ${tone}`}>
            <SquaresFour size={16} className="muted shrink-0" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="muted shrink-0 text-xs">Go to</span>
          </button>
        )}
      </li>
    );
  };

  const fileItems = items.filter((item) => item.kind === 'file');
  const searchItems = items.filter((item) => item.kind === 'search');
  const navItems = items.filter((item) => item.kind === 'nav');
  const indexOf = (item: Item) => items.indexOf(item);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Find a file, a search or a page"
      description="Type to search the registry, or jump anywhere your role allows."
    >
      <div className="relative">
        <MagnifyingGlass
          size={18}
          className="muted pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
        />
        <input
          ref={inputRef}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={onKeyDown}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-label="Search files, recent searches and pages"
          placeholder="Search by barcode, file number, subject, location…"
          className="focus-ring h-11 w-full rounded-xl border border-base bg-[var(--rr-bg)] pl-10 pr-3 text-sm outline-none"
        />
      </div>

      <ul id="palette-list" role="listbox" className="mt-3 space-y-1">
        {searching && fileItems.length > 0 && (
          <li className="muted px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.12em]">
            Files
          </li>
        )}
        {fileItems.map((item) => row(item, indexOf(item), 'Files'))}
        {searchItems.length > 0 && (
          <li className="muted px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.12em]">
            Recent searches
          </li>
        )}
        {searchItems.map((item) => row(item, indexOf(item), 'Recent searches'))}
        {navItems.length > 0 && (
          <li className="muted px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.12em]">
            {searching ? 'Pages' : 'Go to'}
          </li>
        )}
        {navItems.map((item) => row(item, indexOf(item), 'Pages'))}
      </ul>

      {searching && page.items.length === 0 && (
        <p className="muted px-3 pb-2 pt-4 text-sm">
          No files match “{deferred}”. Press Enter to search the full registry instead.
        </p>
      )}
      {!searching && items.length === 0 && (
        <p className="muted px-3 pb-2 pt-4 text-sm">
          Nothing here yet — recent files and searches appear as you use the registry.
        </p>
      )}

      <p className="muted mt-4 border-t border-base pt-3 text-xs">
        <kbd className="rounded border border-base px-1.5">↑↓</kbd> to move ·{' '}
        <kbd className="rounded border border-base px-1.5">Enter</kbd> to open ·{' '}
        <kbd className="rounded border border-base px-1.5">Esc</kbd> to close
      </p>
    </Modal>
  );
}
