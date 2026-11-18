import { useFeatures, applyFeatures, FEATURE_GROUPS, type FeatureKey } from '../lib/features';
import { service } from '../services';
import { dataSource } from '../services';
import { CheckCircle, Circle, Sliders } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';

import {
  ArrowCounterClockwise,
  Bell,
  Database,
  Globe,
  Moon,
  ShieldCheck,
  Trash,
} from '@phosphor-icons/react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { useDb, useSession } from '../hooks/useService';
import { ROLE_DESCRIPTIONS, permissionsFor } from '../services/permissions';
import { ROLES } from '../types';

/**
 * Settings.
 *
 * Removed from the previous build: the Firebase connection card. Firebase is
 * not part of this project (`AGENTS.md`), so the surface no longer advertises a
 * backend that does not exist. Inquiry and media pages stay local until
 * `dotnet-api/` provides endpoints.
 */
export function SettingsPage() {
  const features = useFeatures();
  const db = useDb();
  const { user } = useSession();
  const [notifications, setNotifications] = useState(true);
  const [dark, setDark] = useState(localStorage.getItem('rr-dark') === '1');

  const resetDataset = () => {
    if (!window.confirm('Reset every local change and reload the seed dataset?')) return;
    window.localStorage.removeItem('rr-db-v1');
    window.location.reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="System settings"
        title="Settings"
        description="Configuration surfaces for frontend prototype behaviour. Production values belong behind authenticated administrative APIs."
      />

      <FeatureVisibilityCard />

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <Setting
            icon={<Globe />}
            title="Deployment"
            label="Base URL"
            value="/"
            note="Vite and Netlify are configured for root deployment with SPA fallback."
          />
          <Setting
            icon={<Database />}
            title="Data source"
            label="Local snapshot"
            value={`${db.files.length} registry rows in localStorage`}
            note="The service layer in src/services is the seam. An HTTP adapter against dotnet-api/ replaces the in-memory store without touching a page."
          />
          <Setting
            icon={<ShieldCheck />}
            title="Secrets"
            label="Client credentials"
            value="None"
            note="No API key, service account or admin credential is committed. Authentication and authorization belong server-side — see docs/SECURITY.md."
          />
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-accent-soft p-2 text-accent">
              <ShieldCheck size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold">Your session</p>
              <p className="muted text-xs">Permissions granted to {user?.role ?? 'no role'}.</p>
            </div>
          </div>
          <ul className="mt-5 grid gap-1.5">
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
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-accent-soft p-2 text-accent">
              <Bell size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold">Operational preferences</p>
              <p className="muted text-xs">Local demo settings only.</p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <Toggle
              icon={<Bell />}
              label="Operational notifications"
              value={notifications}
              setValue={setNotifications}
            />
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
          </div>
          <div className="mt-5 rounded-xl bg-accent-soft p-4">
            <Badge tone="info">Frontend only</Badge>
            <p className="muted mt-2 text-xs leading-6">
              Role, audit, retention, storage and search policies must be backend-enforced. Hiding a
              control in this UI is not authorization.
            </p>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-accent-soft p-2 text-accent">
              <ArrowCounterClockwise size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold">Local dataset</p>
              <p className="muted text-xs">Everything you changed in this browser session.</p>
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
            onClick={resetDataset}
          >
            Reset to seed data
          </Button>
          <p className="muted mt-3 text-[11px] leading-5">
            Clears <span className="font-mono">rr-db-v1</span> from localStorage and reloads the
            bundle. Handy after experimenting with issue, return and location flows.
          </p>
        </Card>
      </div>
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
        className={`h-6 w-11 rounded-full p-1 transition ${value ? 'bg-[var(--rr-accent)]' : 'bg-[var(--rr-surface-2)]'}`}
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
          <p className="text-sm font-semibold">Feature visibility</p>
          <p className="muted text-xs">
            Grouped switches — enabling a group enables every related surface. Hidden groups stay
            built and tested; they come back without a redeploy.
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
                features[group.key] ? 'bg-[var(--rr-accent)]' : 'bg-[var(--rr-surface-2)]'
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
