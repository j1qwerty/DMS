import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Gear, List, MagnifyingGlass, Moon, SignOut, Sun } from '@phosphor-icons/react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../hooks/useService';
import { BrandMark } from './Sidebar';
import { CommandPalette } from '../components/CommandPalette';
import { useFeatures } from '../lib/features';
import { APP_SHORT } from '../lib/brand';
import { dataSource } from '../services';

/**
 * Which data layer is live, always visible (round 4): a red dot while the app
 * runs on the in-browser demo dataset — nothing you create reaches a server —
 * and a green dot once VITE_API_MODE=http points at the .NET API.
 */
function DataSourceBadge() {
  const demo = dataSource === 'local';
  return (
    <span
      title={
        demo
          ? 'Demo mode: data lives only in this browser. Start the API (dotnet run, port 5199) and set VITE_API_MODE=http in record-room-frontend/.env.local to work against the real database.'
          : 'Live API: every change is written to the .NET API and its database.'
      }
      className={`focus-ring inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold ${
        demo
          ? 'border-[color-mix(in_srgb,var(--rr-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--rr-danger)_10%,transparent)] text-[var(--rr-danger)]'
          : 'border-[color-mix(in_srgb,var(--rr-success)_40%,transparent)] bg-[color-mix(in_srgb,var(--rr-success)_10%,transparent)] text-[var(--rr-success)]'
      }`}
    >
      <span className="relative flex size-2">
        {demo && (
          <span className="absolute inline-flex size-2 animate-ping rounded-full bg-[var(--rr-danger)] opacity-60" />
        )}
        <span
          className={`relative inline-flex size-2 rounded-full ${
            demo ? 'bg-[var(--rr-danger)]' : 'bg-[var(--rr-success)]'
          }`}
        />
      </span>
      <span className="hidden sm:inline">{demo ? 'Demo data' : 'Live API'}</span>
    </span>
  );
}

export function Topbar({
  dark,
  setDark,
  onMenu,
}: {
  dark: boolean;
  setDark: (value: boolean) => void;
  onMenu: () => void;
}) {
  const navigate = useNavigate();
  const path = useLocation().pathname;
  const hideSearch = path === '/files';
  const { user, signOut } = useSession();
  const features = useFeatures();
  const [term, setTerm] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // "/" and Ctrl/Cmd+K open the command palette (E8) from anywhere that is not
  // already a text field. On /files the topbar search box is hidden, so the
  // palette is the only search surface this shortcut reaches there.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.key === '/' && !typing) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = term.trim();
    navigate(value ? `/files?q=${encodeURIComponent(value)}` : '/files');
    inputRef.current?.blur();
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-base bg-[color-mix(in_srgb,var(--rr-surface)_92%,transparent)] px-3 backdrop-blur-xl sm:gap-3 md:px-6">
      <button
        onClick={onMenu}
        className="focus-ring grid size-11 place-items-center rounded-lg hover:bg-[var(--rr-surface-2)] lg:hidden"
        aria-label="Open navigation"
      >
        <List size={22} />
      </button>
      <Link to="/files" className="focus-ring flex items-center gap-2 rounded-lg lg:hidden">
        <BrandMark size={30} />
        <span className="hidden text-[15px] font-bold tracking-tight min-[400px]:inline">
          {APP_SHORT}
        </span>
      </Link>

      <form
        onSubmit={submit}
        role="search"
        className={`relative ml-auto min-w-0 flex-1 md:max-w-xl lg:ml-0 ${hideSearch ? 'hidden' : ''}`}
      >
        <MagnifyingGlass
          size={18}
          className="muted pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
        />
        <input
          ref={inputRef}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          type="search"
          enterKeyHint="search"
          aria-label="Search records"
          placeholder={
            features.barcode
              ? 'Find a document by file number, barcode or subject'
              : 'Find a document by file number or subject'
          }
          className="focus-ring h-11 w-full rounded-lg border border-base bg-[var(--rr-bg)] pl-10 pr-10 text-base outline-none placeholder:text-[var(--rr-muted)] sm:text-sm"
        />
        <kbd className="muted pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-base px-1.5 text-[11px] md:block">
          /
        </kbd>
      </form>

      <div className="ml-auto flex items-center gap-1">
        <DataSourceBadge />
        <button
          onClick={() => setDark(!dark)}
          className="focus-ring grid size-11 place-items-center rounded-lg hover:bg-[var(--rr-surface-2)]"
          aria-label={dark ? 'Use light mode' : 'Use dark mode'}
        >
          {dark ? <Sun size={19} /> : <Moon size={19} />}
        </button>

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((open) => !open)}
            className="focus-ring flex items-center gap-2 rounded-lg p-1.5 hover:bg-[var(--rr-surface-2)]"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
          >
            <span className="grid size-8 place-items-center rounded-full bg-[var(--rr-accent-fill)] text-sm font-bold text-white">
              {(user?.displayName ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden text-left leading-tight md:block">
              <span className="block text-[13px] font-semibold">{user?.displayName}</span>
              <span className="muted block text-xs">{user?.role}</span>
            </span>
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="surface animate-fade absolute right-0 top-[calc(100%+6px)] z-40 w-60 rounded-xl p-1.5"
            >
              <div className="border-b border-base px-3 pb-2.5 pt-2">
                <p className="text-sm font-semibold">{user?.displayName}</p>
                <p className="muted text-xs">
                  {user?.role} · {user?.userName}
                </p>
              </div>
              <Link
                to="/settings"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="focus-ring mt-1 flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm hover:bg-[var(--rr-surface-2)]"
              >
                <Gear size={17} /> Settings
              </Link>
              <button
                role="menuitem"
                onClick={signOut}
                className="focus-ring flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-[var(--rr-danger)] hover:bg-[color-mix(in_srgb,var(--rr-danger)_10%,transparent)]"
              >
                <SignOut size={17} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </header>
  );
}
