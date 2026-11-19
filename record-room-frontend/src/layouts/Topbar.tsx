import { useEffect, useState } from 'react';
import { ArrowLeft, List, MagnifyingGlass, Moon, Sun } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { BrandMark } from './Sidebar';
import { CommandPalette } from '../components/CommandPalette';
import { useBackTarget } from '../hooks/useBackTarget';
import { APP_SHORT } from '../lib/brand';
import { apiBase, dataSource } from '../services';

/**
 * Which data layer is live, always visible: a red dot and "Demo data" while
 * the app runs on the in-browser demo dataset, a green dot and "Live API"
 * while the .NET API answers, and a red dot and "API down" when the API mode
 * is on but the server does not answer. The text is shown at every viewport,
 * not just on wide screens, so the state is readable at any width.
 */
function DataSourceBadge() {
  // Poll the health endpoint in http mode so the badge tells the truth when
  // the API is down; in local mode there is nothing to probe.
  const [apiUp, setApiUp] = useState(dataSource === 'api');

  useEffect(() => {
    if (dataSource !== 'api') return;
    let live = true;
    const probe = async () => {
      try {
        const res = await fetch(`${apiBase()}/api/health`);
        if (live) setApiUp(res.ok);
      } catch {
        if (live) setApiUp(false);
      }
    };
    void probe();
    const timer = window.setInterval(() => void probe(), 15000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  const demo = dataSource === 'local';
  const down = !demo && !apiUp;
  const red = demo || down;

  const title = demo
    ? 'Demo mode: data lives only in this browser. Start the API (dotnet run, port 5199) and set VITE_API_MODE=http in record-room-frontend/.env.local to work against the real database.'
    : down
      ? 'The .NET API is not reachable. Start it with dotnet run from dotnet-api/src/RecordRoom.Api and refresh this page.'
      : 'Live API: every change is written to the .NET API and its database.';

  return (
    <span
      title={title}
      className={`focus-ring inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold ${
        red
          ? 'border-[color-mix(in_srgb,var(--rr-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--rr-danger)_10%,transparent)] text-[var(--rr-danger)]'
          : 'border-none'
      }`}
    >
      <span className="relative flex size-2">
        {demo && (
          <span className="absolute inline-flex size-2 animate-ping rounded-full bg-[var(--rr-danger)] opacity-60" />
        )}
        <span
          className={`relative inline-flex size-2 rounded-full ${
            red ? 'bg-[var(--rr-danger)]' : 'bg-[var(--rr-success)]'
          }`}
        />
      </span>
      <span>{demo ? 'Demo data' : down ? 'API down' : ''}</span>
    </span>
  );
}

/**
 * The top bar (round 5): one back button that works everywhere (pages no
 * longer carry their own), the command palette always reachable from every
 * page, and the data-source + theme controls. The signed-in user lives in the
 * sidebar footer.
 */
export function Topbar({
  dark,
  setDark,
  onMenu,
}: {
  dark: boolean;
  setDark: (value: boolean) => void;
  onMenu: () => void;
}) {
  const { back, goBack } = useBackTarget();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // "/" and Ctrl/Cmd+K open the command palette (E8) from anywhere that is
  // not already a text field.
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

      {back && (
        <button
          type="button"
          onClick={goBack}
          className="focus-ring grid size-11 shrink-0 place-items-center rounded-lg border border-base bg-[var(--rr-surface)] hover:bg-[var(--rr-surface-2)]"
          aria-label="Go back"
        >
          <ArrowLeft size={19} />
        </button>
      )}

      {/* The command palette entry point, on every page (round 5). */}
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-label="Open search and commands"
        className="focus-ring flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-base bg-[var(--rr-bg)] pl-3.5 pr-3 text-left md:max-w-xl"
      >
        <MagnifyingGlass size={17} className="muted shrink-0" />
        <span className="muted min-w-0 flex-1 truncate text-sm">Search or jump to…</span>
        <kbd className="muted hidden shrink-0 rounded border border-base px-1.5 text-[11px] sm:inline">
          Ctrl K
        </kbd>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <DataSourceBadge />
        <button
          onClick={() => setDark(!dark)}
          className="focus-ring grid size-11 place-items-center rounded-lg hover:bg-[var(--rr-surface-2)]"
          aria-label={dark ? 'Use light mode' : 'Use dark mode'}
        >
          {dark ? <Sun size={19} /> : <Moon size={19} />}
        </button>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </header>
  );
}
