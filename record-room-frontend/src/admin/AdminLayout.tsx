import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useSession } from '../hooks/useService';
import { can, type Permission } from '../services/permissions';
import { useFeatures } from '../lib/features';

const adminNav: Array<{ to: string; label: string; permission: Permission }> = [
  { to: '/admin/users', label: 'Users & roles', permission: 'users.view' },
  { to: '/admin/employees', label: 'Employees', permission: 'employees.view' },
  { to: '/admin/locations', label: 'Room layout', permission: 'locations.view' },
  { to: '/admin/bulk-import', label: 'Bulk import', permission: 'files.bulkImport' },
  { to: '/admin/audit', label: 'Audit & logins', permission: 'audit.view' },
];

/** Administration is one sidebar entry; its sections are tabs along the top. */
export function AdminLayout() {
  const { user } = useSession();
  const features = useFeatures();
  const { pathname } = useLocation();
  const visible = adminNav.filter((item) => (item.to !== '/admin/bulk-import' || features.bulkImport) && can(user?.role, item.permission));

  // /admin on its own lands on the first section this role may open.
  if (pathname === '/admin' && visible[0]) return <Navigate to={visible[0].to} replace />;

  return (
    <div className="min-w-0 space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-[-0.02em] md:text-3xl">Administration</h1>
        <nav
          className="no-scrollbar -mx-3 mt-4 flex gap-1 overflow-x-auto border-b border-base px-3 sm:mx-0 sm:px-0"
          aria-label="Administration sections"
        >
          {visible.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'focus-ring -mb-px min-h-11 shrink-0 rounded-t-lg border-b-2 px-4 text-sm font-semibold leading-[44px] transition',
                  isActive
                    ? 'border-[var(--rr-accent)] text-accent'
                    : 'muted border-transparent hover:text-[var(--rr-text)]',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
