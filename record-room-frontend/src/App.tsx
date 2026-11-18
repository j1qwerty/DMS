import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { AppShell } from './layouts/AppShell';
import { ToastHost } from './components/ui/Toasts';
import { AdminLayout } from './admin/AdminLayout';
import { RequireAuth, RequirePermission } from './layouts/RouteGuards';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { RequireFeature } from './components/RequireFeature';
import { loadRuntimeFeatures } from './lib/features';
import { apiBase } from './services/http/client';

/**
 * Routes are code-split so an operator opening the issue desk does not
 * download the location designer, the audit log or the barcode centre. The
 * dashboard and the login screen stay eager because they are the two entry
 * points a signed-out or landing user hits first.
 */

const SearchPage = lazy(() =>
  import('./pages/SearchPage').then((m) => ({ default: m.SearchPage })),
);
const RoomsPage = lazy(() => import('./pages/RoomsPage').then((m) => ({ default: m.RoomsPage })));
const RoomDetailPage = lazy(() =>
  import('./pages/RoomDetailPage').then((m) => ({ default: m.RoomDetailPage })),
);
const FilesPage = lazy(() => import('./pages/FilesPage').then((m) => ({ default: m.FilesPage })));
const FileViewerPage = lazy(() =>
  import('./pages/FileViewerPage').then((m) => ({ default: m.FileViewerPage })),
);
const FileDetailPage = lazy(() =>
  import('./pages/FileDetailPage').then((m) => ({ default: m.FileDetailPage })),
);
const NewFilePage = lazy(() =>
  import('./pages/NewFilePage').then((m) => ({ default: m.NewFilePage })),
);
const IssuePage = lazy(() => import('./pages/IssuePage').then((m) => ({ default: m.IssuePage })));
const ReturnPage = lazy(() =>
  import('./pages/ReturnPage').then((m) => ({ default: m.ReturnPage })),
);
const MovementPage = lazy(() =>
  import('./pages/MovementPage').then((m) => ({ default: m.MovementPage })),
);
const BarcodesPage = lazy(() =>
  import('./pages/BarcodesPage').then((m) => ({ default: m.BarcodesPage })),
);
const ScanPage = lazy(() => import('./pages/ScanPage').then((m) => ({ default: m.ScanPage })));
const DigitizationPage = lazy(() =>
  import('./pages/DigitizationPage').then((m) => ({ default: m.DigitizationPage })),
);
const ScanStudioPage = lazy(() =>
  import('./pages/ScanStudioPage').then((m) => ({ default: m.ScanStudioPage })),
);
const CustodyPage = lazy(() =>
  import('./pages/CustodyPage').then((m) => ({ default: m.CustodyPage })),
);
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const SupportPage = lazy(() =>
  import('./pages/SupportPage').then((m) => ({ default: m.SupportPage })),
);

const UsersPage = lazy(() => import('./admin/UsersPage').then((m) => ({ default: m.UsersPage })));
const EmployeesPage = lazy(() =>
  import('./admin/EmployeesPage').then((m) => ({ default: m.EmployeesPage })),
);
const LocationsPage = lazy(() =>
  import('./admin/LocationsPage').then((m) => ({ default: m.LocationsPage })),
);
const BulkImportPage = lazy(() =>
  import('./admin/BulkImportPage').then((m) => ({ default: m.BulkImportPage })),
);
const MapsPage = lazy(() => import('./admin/MapsPage').then((m) => ({ default: m.MapsPage })));
const AuditPage = lazy(() => import('./admin/AuditPage').then((m) => ({ default: m.AuditPage })));

/** Re-mounts the search page when the top-bar query changes so its input follows the URL. */
function KeyedFilesPage() {
  const [params] = useSearchParams();
  return <FilesPage key={`${params.get('q') ?? ''}|${params.get('status') ?? ''}`} />;
}

function KeyedSearchPage() {
  const [params] = useSearchParams();
  return <SearchPage key={params.get('q') ?? ''} />;
}

/** Keeps the layout mounted while a route chunk loads, so the shell does not flash. */
function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm muted">
        <span className="size-2 animate-pulse rounded-full bg-[var(--rr-accent)]" />
        Loading…
      </div>
    </div>
  );
}

const guarded = (
  Page: ComponentType,
  permission: Parameters<typeof RequirePermission>[0]['permission'],
) => (
  <RequirePermission permission={permission}>
    <Page />
  </RequirePermission>
);

export function App() {
  // In http mode the API says which features are on; the build-time flag is the fallback.
  useEffect(() => {
    if (import.meta.env.VITE_API_MODE === 'http') void loadRuntimeFeatures(apiBase());
  }, []);

  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <ToastHost />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Navigate to="/files" replace />} />
            <Route path="/overview" element={<DashboardPage />} />
            <Route path="/search" element={<KeyedSearchPage />} />
            <Route
              path="/rooms"
              element={
                <RequireFeature feature="recordRoom">
                  <RoomsPage />
                </RequireFeature>
              }
            />
            <Route
              path="/rooms/:roomId"
              element={
                <RequireFeature feature="recordRoom">
                  <RoomDetailPage />
                </RequireFeature>
              }
            />
            <Route path="/files" element={<KeyedFilesPage />} />
            <Route path="/files/new" element={guarded(NewFilePage, 'files.create')} />
            <Route path="/files/:fileId" element={<FileDetailPage />} />
            <Route path="/files/:fileId/studio" element={<ScanStudioPage />} />
            <Route path="/files/:fileId/scan" element={<FileViewerPage />} />
            <Route path="/files/:fileId/map" element={<FileViewerPage />} />
            <Route
              path="/maps"
              element={
                <RequireFeature feature="maps">{guarded(MapsPage, 'files.view')}</RequireFeature>
              }
            />
            <Route path="/issue" element={<IssuePage />} />
            <Route path="/return" element={<ReturnPage />} />
            <Route path="/movement" element={<MovementPage />} />
            <Route
              path="/barcodes"
              element={
                <RequireFeature feature="barcode">
                  <BarcodesPage />
                </RequireFeature>
              }
            />
            <Route
              path="/scan"
              element={
                <RequireFeature feature="barcode">
                  <ScanPage />
                </RequireFeature>
              }
            />
            <Route path="/digitization" element={<DigitizationPage />} />
            <Route path="/custody" element={<CustodyPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route
              path="/support"
              element={
                <RequireFeature feature="support">
                  <SupportPage />
                </RequireFeature>
              }
            />
            <Route path="/settings" element={<SettingsPage />} />

            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={guarded(UsersPage, 'users.view')} />
              <Route path="users" element={guarded(UsersPage, 'users.view')} />
              <Route path="employees" element={guarded(EmployeesPage, 'employees.view')} />
              <Route path="locations" element={guarded(LocationsPage, 'locations.view')} />
              <Route path="bulk-import" element={guarded(BulkImportPage, 'files.bulkImport')} />
              <Route
                path="maps"
                element={
                  <RequireFeature feature="maps">{guarded(MapsPage, 'files.view')}</RequireFeature>
                }
              />
              <Route path="audit" element={guarded(AuditPage, 'audit.view')} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
