import { useFeatures, applyFeatures, FEATURE_GROUPS, type FeatureKey } from '../lib/features';
import { service, dataSource } from '../services';
import { CheckCircle, Circle, Sliders } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { Bell, Moon } from '@phosphor-icons/react';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionHeader } from '../components/ui/SectionHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { useSession } from '../hooks/useService';

/**
 * Settings, kept intentionally small: the two personal preferences that live
 * in the browser, and the admin-controlled feature visibility groups.
 *
 * The connection/data, session and deployment sections were removed — they
 * belong in docs, not on a settings surface users toggle.
 */
export function SettingsPage() {
  const [notifications, setNotifications] = useState(true);
  const [dark, setDark] = useState(localStorage.getItem('rr-dark') === '1');

  return (
    <div className="space-y-10">
      <PageHeader title="Settings" />

      {/* ------------------------------------------------------ interface */}
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
            <Toggle
              icon={<Bell />}
              label="Operational notifications"
              value={notifications}
              setValue={setNotifications}
            />
          </div>
        </Card>
      </section>

      {/* ----------------------------------------------- feature visibility */}
      <section aria-label="Feature visibility">
        <SectionHeader title="Feature visibility" />
        <FeatureVisibilityCard />
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
          className={`block size-4 rounded-full bg-white transition ${
            value ? 'translate-x-5' : ''
          }`}
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
 *
 * The card keeps its own `local` mirror of the feature flags and drives the
 * UI from that mirror — the external feature store does not always notify this
 * component on change, so relying on `useFeatures()` alone would leave the
 * switches stale until a full refresh.
 */
function FeatureVisibilityCard() {
  const features = useFeatures();
  const { user } = useSession();
  const isAdmin = user?.role === 'Admin';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<Record<FeatureKey, boolean>>(features);

  useEffect(() => {
    if (dataSource !== 'api') return;
    void service.config
      .features()
      .then((next) => {
        applyFeatures(next);
        setLocal((cur) => ({ ...cur, ...next }));
      })
      .catch(() => undefined);
  }, []);

  const toggle = async (key: FeatureKey) => {
    if (!isAdmin || busy) return;

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
      setBusy(false); // ← always runs, even on throw / reject
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
