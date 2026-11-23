import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle, Circle, Lock, Moon, Sliders, Database } from '@phosphor-icons/react';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionHeader } from '../components/ui/SectionHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { useSession } from '../hooks/useService';
import { useFeatures, applyFeatures, FEATURE_GROUPS, type FeatureKey } from '../lib/features';
import { service, dataSource } from '../services';
import type { AppConfigInfo } from '../services/contracts';
import { OcrEngineCard } from '../admin/OcrEngineCard';

/**
 * Settings, kept intentionally small: the one personal preference that lives
 * in the browser (dark mode), the admin-controlled feature visibility groups,
 * the admin-controlled OCR engine, and a read-only deployment card
 * fed by the environment — the .env file on the server, not the database.
 */
export function SettingsPage() {
  const [dark, setDark] = useState(localStorage.getItem('rr-dark') === '1');

  return (
    <div className="space-y-10">
      <PageHeader title="Settings" />

      <section aria-label="Interface">
        <SectionHeader title="Interface" />
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
          </div>
        </Card>
      </section>

      <section aria-label="Feature visibility">
        <SectionHeader title="Feature visibility" />
        <FeatureVisibilityCard />
      </section>

      <section aria-label="OCR">
        <SectionHeader title="OCR" />
        <OcrEngineCard />
      </section>

      <section aria-label="Deployment">
        <SectionHeader title="Deployment" />
        <DeploymentCard />
      </section>
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
        className={`h-6 w-11 rounded-full p-1 transition ${
          value ? 'bg-[var(--rr-accent-fill)]' : 'bg-[var(--rr-surface-2)]'
        }`}
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
 * current state. When the deployment locked the switchboard
 * (Settings:AllowFeatureEditing in the server's .env), the switches render
 * read-only with a lock notice — the API refuses the write anyway, and the
 * page says why instead of failing.
 */
function FeatureVisibilityCard() {
  const features = useFeatures();
  const { user } = useSession();
  const isAdmin = user?.role === 'Admin';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [local, setLocal] = useState<Record<FeatureKey, boolean>>(features);

  useEffect(() => {
    if (dataSource !== 'api') return;
    void service.config
      .info()
      .then((info) => setLocked(!info.settingsEditable))
      .catch(() => undefined);
    void service.config
      .features()
      .then((next) => {
        applyFeatures(next);
        setLocal((cur) => ({ ...cur, ...next }));
      })
      .catch(() => undefined);
  }, []);

  const toggle = async (key: FeatureKey) => {
    if (!isAdmin || busy || locked) return;

    const previous = local;
    const nextValue = !local[key];

    setBusy(true);
    setError('');
    setLocal((cur) => ({ ...cur, [key]: nextValue })); // optimistic flip

    try {
      const result = await service.config.updateFeatures({ [key]: nextValue });

      if (result.ok) {
        setLocal((cur) => ({ ...cur, ...result.value }));
        try {
          applyFeatures(result.value, dataSource === 'local');
        } catch {
          // Store sync is best-effort; the card already reflects the change
          // and will resync from the server on the next mount.
        }
      } else {
        setLocal(previous);
        setError(result.error ?? 'The feature groups could not be updated.');
      }
    } catch (err) {
      setLocal(previous);
      setError(err instanceof Error ? err.message : 'The feature groups could not be updated.');
    } finally {
      setBusy(false);
    }
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
            Enabling a group enables every related surface. Hidden groups stay built and tested.
            {isAdmin && !locked ? '' : ' Only an admin can change these.'}
          </p>
        </div>
      </div>

      {locked && (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-base bg-[var(--rr-bg)] p-3 text-sm leading-5">
          <Lock size={18} weight="fill" className="mt-0.5 shrink-0 text-[var(--rr-warning)]" />
          <div>
            <strong>Locked by the server environment.</strong> This deployment controls feature
            visibility through its <span className="mono">.env</span> file, so the switches are
            read-only here and the API refuses changes. An operator edits{' '}
            <span className="mono">Settings__AllowFeatureEditing</span> (and the{' '}
            <span className="mono">Features__*</span> keys) in the deployment configuration and
            restarts the API.
          </div>
        </div>
      )}

      <div className="mt-5 space-y-3">
        {FEATURE_GROUPS.map((group) => (
          <button
            key={group.key}
            onClick={() => toggle(group.key)}
            disabled={!isAdmin || busy || locked}
            aria-pressed={local[group.key]}
            className="focus-ring flex w-full items-start justify-between gap-4 rounded-xl bg-[var(--rr-bg)] p-3 text-left disabled:cursor-default"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-semibold">
                {local[group.key] ? (
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
                local[group.key] ? 'bg-[var(--rr-accent-fill)]' : 'bg-[var(--rr-surface-2)]'
              }`}
            >
              <span
                className={`block size-4 rounded-full bg-white transition ${
                  local[group.key] ? 'translate-x-5' : ''
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

/** Read-only deployment facts from GET /api/config — the environment decides, not the database. */
function DeploymentCard() {
  const [info, setInfo] = useState<AppConfigInfo | null>(null);

  useEffect(() => {
    void service.config
      .info()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-accent-soft p-2 text-accent">
          <Database size={18} />
        </div>
        <div>
          <p className="text-sm font-semibold">Deployment</p>
          <p className="muted text-xs">
            Read-only — these values come from the server environment (its .env file), not the
            database.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <Row
          icon={<Database size={16} />}
          label="Data"
          value={
            info
              ? info.demoMode
                ? 'Demo dataset'
                : 'Live registry'
              : dataSource === 'local'
                ? 'Local demo (in this browser)'
                : '…'
          }
          tone={info?.demoMode || dataSource === 'local' ? 'warning' : 'success'}
        />
        <Row
          icon={<Sliders size={16} />}
          label="Feature editing"
          value={
            info
              ? info.settingsEditable
                ? 'Allowed at runtime'
                : 'Locked to the environment'
              : '…'
          }
          tone={info?.settingsEditable === false ? 'neutral' : 'success'}
        />
      </div>
    </Card>
  );
}

function Row({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--rr-bg)] p-3">
      <span className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-accent">{icon}</span>
        {label}
      </span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  );
}
