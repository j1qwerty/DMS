import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useSession } from '../hooks/useService';
import { useFeatures } from '../lib/features';
import type { Permission } from '../services/permissions';
import { useFeatures, type Features } from '../lib/features';

interface Tab {
  label: string;
  to: string;
  permission?: Permission;
  /** Shown only while barcode features are on. */
  barcode?: boolean;
  feature?: keyof Features;
}

interface Group {
  title: string;
  /** Path prefixes that belong to this group. */
  match: string[];
  tabs: Tab[];
}

/**
 * Tab strips for sidebar entries that cover several related screens. Rendered by the
 * shell above the page, so the pages themselves do not each carry their own copy.
 */
const GROUPS: Group[] = [
  {
    title: 'Record room · Issue & return',
    match: ['/issue', '/return', '/movement', '/scan'],
    tabs: [
      { label: 'Issue files', to: '/issue', permission: 'issue.issue' },
      { label: 'Return files', to: '/return', permission: 'issue.return' },
      { label: 'Movement log', to: '/movement', feature: 'movement' },
      { label: 'Scan a barcode', to: '/scan', barcode: true },
    ],
  },
  {
    title: 'Record room · Rooms & shelves',
    match: ['/rooms', '/barcodes'],
    tabs: [
      { label: 'Rooms', to: '/rooms' },
      { label: 'Barcode labels', to: '/barcodes', permission: 'barcodes.print', barcode: true },
    ],
  },
];

export function SubNav() {
  const { pathname } = useLocation();
  const { allowed } = useSession();
  const features = useFeatures();
  const group = GROUPS.find((item) => item.match.some((prefix) => pathname.startsWith(prefix)));
  if (!group) return null;
  const tabs = group.tabs.filter(
    (tab) => (!tab.barcode || features.barcode) && (!tab.feature || features[tab.feature]) && (!tab.permission || allowed(tab.permission)),
  );
  if (tabs.length < 2) return null;

  return (
    <nav
      aria-label={group.title}
      className="no-scrollbar -mx-3 mb-5 flex gap-1 overflow-x-auto border-b border-base px-3 sm:mx-0 sm:px-0"
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/rooms'}
          className={({ isActive }) =>
            cn(
              'focus-ring -mb-px min-h-11 shrink-0 rounded-t-lg border-b-2 px-4 text-sm font-semibold leading-[44px] transition',
              isActive
                ? 'border-[var(--rr-accent)] text-accent'
                : 'muted border-transparent hover:text-[var(--rr-text)]',
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
