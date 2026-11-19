import { useFeatures, applyFeatures, FEATURE_GROUPS, type FeatureKey } from '../lib/features';
import { service, dataSource } from '../services';
import { CheckCircle, Circle, Sliders } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';

import {
  ArrowCounterClockwise,
  Bell,
  Database,
  Globe,
  HardDrives,
  Moon,
  ShieldCheck,
  Trash,
} from '@phosphor-icons/react';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionHeader } from '../components/ui/SectionHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { useDb, useSession } from '../hooks/useService';
import { ROLE_DESCRIPTIONS, permissionsFor } from '../services/permissions';
import { ROLES } from '../types';

/**
 * Settings, grouped the way it is read (round 4): connection and data first —
 * which data layer is live is the one setting that changes what the whole app
 * does — then appearance, feature visibility, the signed-in session, and the
 * deployment facts. Previously the cards were scattered across two grids with
 * no order.
 *
 * Removed from a previous build: the Firebase connection card. Firebase is not
 * part of this project (`AGENTS.md`), so the surface no longer advertises a
 * backend that does not exist.
 */
export function SettingsPage() {
  const features = useFeatures();
  const db = useDb();
  const { user } = useSession();
  const [notifications, setNotifications] = useState(true);
  const [dark, setDark] = useState(localStorage.getItem('rr-dark') === '1');

  const demo = dataSource === 'local';

  // The reset used to clear a key that no longer exists (rr-db-v1; the store
  // moved to rr-db-v2) and left demo documents in place. The service reset
  // clears the store and the IndexedDB document store together.
  const resetDataset = async () => {
    if (!window.confirm('Reset every local change and reload the seed dataset?')) return;
    try {
      await service.reset();
    } finally {
      window.location.reload();
    }
  };

  return (
    <div className="space-y-10">
      <PageHeader
        kicker="System settings"
        title="Settings"
        description="Grouped by what they affect: the connection and its data, how the app looks, which feature areas are visible, your session, and the deployment facts."
      />

      {/* ------------------------------------------------- connection + data */}
      <section aria-label="Connection and data">
        <SectionHeader
          eyebrow="Where your data lives"
          title="Connection & data"
          description={
            demo
              ? 'The app is running on the in-browser demo dataset: fast to try, but nothing is stored on a server and a cleared browser loses it.'
              : 'The app is connected to the .NET API: every change is written to SQL Server through the API, with server-enforced rules, OCR and durable file storage.'
          }
        />
        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-accent-soft p-2 text-accent">
                <Database size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Data source</p>
                <div className="mt-1.5 flex items-center gap-2">
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
                  <span
                    className={`text-xs font-bold ${
                      demo ? 'text-[var(--rr-danger)]' : 'text-[var(--rr-success)]'
                    }`}
                  >
                    {demo ? 'Demo data (this browser only)' : 'Live API'}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-5 space-y-3 text-xs leading-6">
              {demo ? (
                <>
                  <p className="muted">
                    Demo mode keeps rows in <span className="font-mono">localStorage</span> and
                    document bytes in <span className="font-mono">IndexedDB</span> — they survive a
                    refresh, but not a cleared browser, and no other machine sees them.
                  </p>
                  <p className="muted">
                    To work against the real database: start the API (
                    <span className="font-mono">
                      cd ../dotnet-api/src/RecordRoom.Api && dotnet run --urls http://localhost:5199
                    </span>
                    ), then set <span className="font-mono">VITE_API_MODE=http</span> in{' '}
                    <span className="font-mono">record-room-frontend/.env.local</span> (the shipped
                    file already says so) and restart <span className="font-mono">pnpm dev</span>.
                    The red dot in the top bar turns green when the API is live.
                  </p>
                </>
              ) : (
                <>
                  <p className="muted">
                    Every page reads and writes through the API: registrations, custody, issues,
                    scans and audit all land in SQL Server, and uploaded files are stored on the
                    API's private document store.
                  </p>
                  <p className="muted">
                    The top bar shows a green <strong>Live API</strong> dot in this mode. Switching
                    back to the demo dataset means removing{' '}
                    <span className="font-mono">.env.local</span> (or setting{' '}
                    <span className="font-mono">VITE_API_MODE=local</span>) and restarting the dev
                    server.
                  </p>
                </>
              )}
            </div>
          </Card>

          {demo ? (
            <Card>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-accent-soft p-2 text-accent">
                  <ArrowCounterClockwise size={18} />
                </div>
                <div>
                  <p className="text-sm font-semibold">Local dataset</p>
                  <p className="muted text-xs">Everything you changed in this browser.</p>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3 text-xs">
                <Count label="Registry rows" value={db.files.length} />
                <Count label="Receipts" value={db.issues.length} />
                <Count label="Movement events" value={db.movements.length} />
                <Count label="Audit entries" value={db.audit.length} />
                <Count label="Employees" value={db.employees.length} />
                <Count label="Digitization pages" value={db.scanPages.length} />
              </dl>
              <Button
                className="mt-5 w-full"
                variant="danger"
                icon={<Trash size={17} />}
                onClick={() => void resetDataset()}
              >
                Reset to seed data
              </Button>
              <p className="muted mt-3 text-[11px] leading-5">
                Clears the local store and the stored demo documents, then reloads. In Live API mode
                the data is owned by the server — this card only exists in demo mode.
              </p>
            </Card>
          ) : (
            <Card>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-accent-soft p-2 text-accent">
                  <HardDrives size={18} />
                </div>
                <div>
                  <p className="text-sm font-semibold">Server-owned data</p>
                  <p className="muted text-xs">Counts live in the API's database.</p>
                </div>
              </div>
              <p className="muted mt-5 text-xs leading-6">
                Registry rows, custody events, issues, movements, scan pages, audit entries and
                document bytes all belong to the API in this mode. Use the Reports section and the
                administration pages for server-side figures; nothing is reset from the browser.
              </p>
            </Card>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------ the interface */}
      <section aria-label="Interface">
        <SectionHeader
          eyebrow="How the app looks and pings you"
          title="Interface"
          description="Personal, browser-local preferences. Nothing here changes what anyone else sees."
        />
        <Card>
          <div className="grid gap-3 md:grid-cols-2">
            <Toggle
              icon={<Moon />}
              label="Dark mode"
              value={dark}
              setValue={(value) => {
                setDark(value);
                localStorage.setItem('rr-dark', value ? '1' : '0');
                document.documentElement.classList.toggle('dark', value);
              }}
            />
            <Toggle
              icon={<Bell />}
              label="Operational notifications"
              value={notifications}
              setValue={setNotifications}
            />
          </div>
          <div className="mt-5 rounded-xl bg-accent-soft p-4">
            <Badge tone="info">Frontend only</Badge>
            <p className="muted mt-2 text-xs leading-6">
              Role, audit, retention, storage and search policies are backend-enforced. Hiding a
              control in this UI is not authorization.
            </p>
          </div>
        </Card>
      </section>

      {/* --------------------------------------------------- feature visibility */}
      <section aria-label="Feature visibility">
        <SectionHeader
          eyebrow="What is visible to users"
          title="Feature visibility"
          description="Grouped switches that hide whole capability areas without removing them. Admin-only writes; everyone sees the current state."
        />
        <FeatureVisibilityCard />
      </section>

      {/* ----------------------------------------------------------- session */}
      <section aria-label="Your session">
        <SectionHeader
          eyebrow={`Signed in as ${user?.displayName ?? user?.userName ?? '—'}`}
          title="Your session"
          description={`Permissions granted to ${user?.role ?? 'no role'}, and how the roles differ.`}
        />
        <Card>
          <ul className="grid gap-1.5">
            {permissionsFor(user?.role ?? 'Employee')
              .filter((permission) => features.barcode || permission !== 'barcodes.print')
              .map((permission) => (
                <li key={permission} className="flex items-center gap-2 text-xs">
                  <span className="size-1.5 rounded-full bg-[var(--rr-success)]" />
                  <span className="font-mono">{permission}</span>
                </li>
              ))}
          </ul>

          <div className="mt-5 border-t border-base pt-5">
            <p className="text-xs font-bold uppercase tracking-[0.12em] muted">Role summary</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {ROLES.map((role) => (
                <div
                  key={role}
                  className={`rounded-xl p-3 text-xs ${
                    role === user?.role ? 'bg-accent-soft' : 'bg-[var(--rr-bg)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{role}</span>
                    {role === user?.role && <Badge tone="info">You</Badge>}
                  </div>
                  <p className="muted mt-1 leading-5">{ROLE_DESCRIPTIONS[role]}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </section>

      {/* --------------------------------------------------------- deployment */}
      <section aria-label="Deployment facts">
        <SectionHeader
          eyebrow="Read-only facts"
          title="Deployment"
          description="Static build facts; nothing here is a runtime switch."
        />
        <Card>
          <Setting
            icon={<Globe />}
            title="Web app"
            label="Base URL"
            value="/"
            note="Vite and Netlify are configured for root deployment with SPA fallback."
          />
          <Setting
            icon={<ShieldCheck />}
            title="Secrets"
            label="Client credentials"
            value="None"
            note="No API key, service account or admin credential is committed. Authentication and authorization belong server-side — see docs/SECURITY.md."
          />
        </Card>
      </section>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-[var(--rr-bg)] p-3">
      <dt className="muted text-[10px] uppercase tracking-wider">{label}</dt>
      <dd className="mt-1 text-lg font-semibold">{value}</dd>
    </div>
  );
}

function Setting({
  icon,
  title,
  label,
  value,
  note,
}: {
  icon: ReactNode;
  title: string;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="border-b border-base py-4 first:pt-0 last:border-b-0">
      <div className="flex gap-3">
        <div className="rounded-lg bg-accent-soft p-2 text-accent">{icon}</div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs">
            {label}: <span className="font-semibold">{value}</span>
          </p>
          <p className="muted mt-1 text-[10px] leading-5">{note}</p>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  icon,
  label,
  value,
  setValue,
}: {
  icon: ReactNode;
  label: string;
  value: boolean;
  setValue: (value: boolean) => void;
}) {
  return (
    <button
      onClick={() => setValue(!value)}
      className="focus-ring flex w-full items-center justify-between rounded-xl bg-[var(--rr-bg)] p-3 text-left"
      aria-pressed={value}
    >
      <span className="flex items-center gap-3">
        <span className="text-accent">{icon}</span>
        <span className="text-sm font-semibold">{label}</span>
      </span>
      <span
        className={`h-6 w-11 rounded-full p-1 transition ${value ? 'bg-[var(--rr-accent-fill)]' : 'bg-[var(--rr-surface-2)]'}`}
      >
        <span
          className={`block size-4 rounded-full bg-white transition ${value ? 'translate-x-5' : ''}`}
        />
      </span>
    </button>
  );
}

/**
 * Feature visibility (ZILA_PANCHAYAT_CC §F): grouped switches that hide whole
 * capability areas without removing them. Admin-only writes; everyone sees the
 * current state. Local mode persists to localStorage; http mode writes the
 * API's FeatureSettings rows (audit-logged server-side).
 */
function FeatureVisibilityCard() {
  const features = useFeatures();
  const { user } = useSession();
  const isAdmin = user?.role === 'Admin';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (dataSource !== 'api') return;
    // Refresh from the server so another admin's change shows up on navigation.
    void service.config
      .features()
      .then((next) => applyFeatures(next))
      .catch(() => undefined);
  }, []);

  const toggle = async (key: FeatureKey) => {
    if (!isAdmin || busy) return;
    setBusy(true);
    setError('');
    const result = await service.config.updateFeatures({ [key]: !features[key] });
    if (result.ok) {
      applyFeatures(result.value, dataSource === 'local');
    } else {
      setError(result.error ?? 'The feature groups could not be updated.');
    }
    setBusy(false);
  };

  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-accent-soft p-2 text-accent">
          <Sliders size={18} />
        </div>
        <div>
          <p className="text-sm font-semibold">Feature groups</p>
          <p className="muted text-xs">
            Enabling a group enables every related surface. Hidden groups stay built and tested;
            they come back without a redeploy.
            {isAdmin ? '' : ' Only an admin can change these.'}
          </p>
        </div>
      </div>
      <div className="mt-5 space-y-3">
        {FEATURE_GROUPS.map((group) => (
          <button
            key={group.key}
            onClick={() => toggle(group.key)}
            disabled={!isAdmin || busy}
            aria-pressed={features[group.key]}
            className="focus-ring flex w-full items-start justify-between gap-4 rounded-xl bg-[var(--rr-bg)] p-3 text-left disabled:cursor-default"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-semibold">
                {features[group.key] ? (
                  <CheckCircle size={16} weight="fill" className="text-[var(--rr-success)]" />
                ) : (
                  <Circle size={16} className="muted" />
                )}
                {group.label}
              </span>
              <span className="muted mt-1 block text-xs leading-5">{group.description}</span>
              <span className="mt-1.5 flex flex-wrap gap-1">
                {group.includes.map((item) => (
                  <Badge key={item} tone="neutral">
                    {item}
                  </Badge>
                ))}
              </span>
            </span>
            <span
              className={`mt-1 h-6 w-11 shrink-0 rounded-full p-1 transition ${
                features[group.key] ? 'bg-[var(--rr-accent-fill)]' : 'bg-[var(--rr-surface-2)]'
              }`}
            >
              <span
                className={`block size-4 rounded-full bg-white transition ${
                  features[group.key] ? 'translate-x-5' : ''
                }`}
              />
            </span>
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-xs text-[var(--rr-danger)]">{error}</p>}
    </Card>
  );
}
