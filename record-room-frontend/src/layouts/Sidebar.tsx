import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  Archive,
  ChartBar,
  ClipboardText,
  Files,
  Gauge,
  Gear,
  ShieldCheck,
  SignOut,
  Stack,
  X,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { cn } from '../lib/utils';
import { useSession } from '../hooks/useService';
import { can, type Permission } from '../services/permissions';
import { useFeatures, type FeatureKey } from '../lib/features';
import { APP_NAME } from '../lib/brand';

interface NavItem {
  label: string;
  to: string;
  icon: Icon;
  /** Extra path prefixes that should light this item up. */
  also?: string[];
  permission?: Permission;
  anyOf?: Permission[];
  /** Feature group this entry belongs to; hidden while the group is off. */
  feature?: FeatureKey;
}

/**
 * The product is a Document Management System. The menu follows the work: the
 * overview first, then the register, digitization (scan review and custody on
 * one page), the issue desk and the rooms. Maps are a Documents filter, not a
 * separate destination, and support lives in Settings — so nothing opens the
 * same page twice.
 */
const groups: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Workspace',
    items: [
      { label: 'Overview', to: '/overview', icon: Gauge },
      { label: 'Documents', to: '/files', icon: Files, also: ['/search', '/maps'] },
      { label: 'Digitization', to: '/digitization', icon: Archive, also: ['/custody'] },
      {
        label: 'Issue & return',
        to: '/issue',
        icon: ClipboardText,
        also: ['/return', '/movement', '/scan'],
      },
      {
        label: 'Rooms & shelves',
        to: '/rooms',
        icon: Stack,
        also: ['/barcodes'],
        feature: 'recordRoom',
      },
      { label: 'Reports', to: '/reports', icon: ChartBar, permission: 'reports.view' },
    ],
  },
  {
    title: 'Manage',
    items: [
      {
        label: 'Administration',
        to: '/admin',
        icon: ShieldCheck,
        anyOf: ['users.view', 'employees.view', 'locations.view', 'audit.view', 'audit.fileViews'],
      },
    ],
  },
];

const footerLinks: NavItem[] = [{ label: 'Settings', to: '/settings', icon: Gear }];

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <div
      className="grid shrink-0 place-items-center rounded-lg bg-[var(--rr-accent-fill)] text-white"
      style={{ width: size, height: size }}
    >
      <Archive size={Math.round(size * 0.55)} weight="bold" />
    </div>
  );
}

export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const location = useLocation();
  const { user, signOut } = useSession();
  const features = useFeatures();

  const permitted = (item: NavItem) => {
    if (item.feature && !features[item.feature]) return false;
    if (item.anyOf) return item.anyOf.some((permission) => can(user?.role, permission));
    return !item.permission || can(user?.role, item.permission);
  };

  const visibleGroups = groups
    .map((group) => ({ ...group, items: group.items.filter(permitted) }))
    .filter((group) => group.items.length > 0);

  const isActive = (item: NavItem) =>
    [item.to, ...(item.also ?? [])].some((prefix) => location.pathname.startsWith(prefix));

  const link = (item: NavItem) => {
    const active = isActive(item);
    const Icon = item.icon;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        onClick={onClose}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'focus-ring flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] transition',
          active
            ? 'bg-accent-soft font-semibold text-accent'
            : 'muted hover:bg-[var(--rr-surface-2)] hover:text-[var(--rr-text)]',
        )}
      >
        <Icon size={20} weight={active ? 'fill' : 'regular'} />
        {item.label}
      </NavLink>
    );
  };

  return (
    <>
      {mobileOpen && (
        <button
          aria-label="Close navigation"
          onClick={onClose}
          className="animate-fade fixed inset-0 z-40 bg-slate-950/45 lg:hidden"
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[260px] max-w-[86vw] flex-col border-r border-base bg-[var(--rr-surface)] transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between px-4">
          <Link
            to="/files"
            onClick={onClose}
            className="focus-ring flex items-center gap-3 rounded-lg"
          >
            <BrandMark />
            <div className="text-[15px] font-bold leading-tight tracking-tight">{APP_NAME}</div>
          </Link>
          <button
            onClick={onClose}
            className="focus-ring grid size-10 place-items-center rounded-lg hover:bg-[var(--rr-surface-2)] lg:hidden"
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-4" aria-label="Primary">
          {visibleGroups.map((group) => (
            <div key={group.title} className="mt-5 first:mt-2">
              <div className="muted px-3 pb-1.5 text-xs font-semibold">{group.title}</div>
              <div className="space-y-0.5">{group.items.map(link)}</div>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-base p-3">
          <div className="space-y-0.5">{footerLinks.filter(permitted).map(link)}</div>
          {/* The signed-in user shows on the topbar only; here a quiet way out. */}
          <button
            type="button"
            onClick={signOut}
            className="focus-ring muted mt-2 flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-[15px] transition hover:bg-[var(--rr-danger)] hover:text-white"
            aria-label="Sign out"
          >
            <SignOut size={20} />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
