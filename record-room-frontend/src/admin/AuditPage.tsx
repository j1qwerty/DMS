import { useState } from 'react';
import { DownloadSimple, MagnifyingGlass, ShieldCheck } from '@phosphor-icons/react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { SelectInput, TextInput } from '../components/ui/Field';
import { EmptyState } from '../components/ui/EmptyState';
import { useQuery, useService, useSession } from '../hooks/useService';
import { AUDIT_ACTIONS, auditRowsToCsv } from '../services';
import { downloadCsv, slugify, toCsv } from '../lib/csv';
import type { AuditAction, AuditEntry, LoginHistoryEntry, LoginOutcome } from '../types';

const EMPTY_ENTRIES: AuditEntry[] = [];
const EMPTY_LOGINS: LoginHistoryEntry[] = [];

const OUTCOMES: Array<LoginOutcome | 'All'> = ['All', 'Success', 'Failed', 'Signed out'];

const ACTION_TONE: Record<AuditAction, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  Login: 'success',
  Logout: 'neutral',
  Create: 'info',
  Update: 'info',
  Delete: 'danger',
  Issue: 'warning',
  Return: 'success',
  Relocate: 'warning',
  Approve: 'success',
  Reject: 'danger',
  Export: 'neutral',
  View: 'info',
};

type Tab = 'documents' | 'digitization' | 'logins' | 'issues' | 'views';

/**
 * The audit trail, grouped the way it is read: documents, digitization, then
 * logins and issues as their own tabs (round 4 — they shared one tab in round
 * 3), plus the file-view trail behind its own permission. Every entry is
 * written by the service that made the change, so the trail carries the actor,
 * role, address and both states.
 */
export function AuditPage() {
  const service = useService();
  const { allowed } = useSession();
  const canSeeViews = allowed('audit.fileViews');

  const [tab, setTab] = useState<Tab>('documents');
  const [search, setSearch] = useState('');
  const [action, setAction] = useState<AuditAction | 'All'>('All');
  const [outcome, setOutcome] = useState<LoginOutcome | 'All'>('All');

  const groupOf = (key: Tab) => {
    if (key === 'documents' || key === 'digitization') return key;
    if (key === 'logins') return 'logins' as const;
    return 'issues' as const;
  };

  const { data: entries, loading: loadingEntries } = useQuery(
    () =>
      tab === 'logins'
        ? Promise.resolve(EMPTY_ENTRIES)
        : service.audit.list({
            search,
            action:
              tab === 'documents' || tab === 'digitization' || tab === 'issues'
                ? action
                : undefined,
            group: groupOf(tab),
            limit: 300,
          }),
    [search, action, tab],
    EMPTY_ENTRIES,
  );
  const { data: logins, loading: loadingLogins } = useQuery(
    () =>
      tab === 'logins'
        ? service.audit.loginHistory({ search, outcome })
        : Promise.resolve(EMPTY_LOGINS),
    [search, outcome, tab],
    EMPTY_LOGINS,
  );
  const { data: views, loading: loadingViews } = useQuery(
    () =>
      canSeeViews && tab === 'views'
        ? service.audit.fileViews({ search, limit: 300 })
        : Promise.resolve(EMPTY_ENTRIES),
    [search, tab, canSeeViews],
    EMPTY_ENTRIES,
  );

  const exportAudit = () => {
    const rows = tab === 'views' ? views : entries;
    downloadCsv(
      `${slugify(`audit-${tab}`)}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        [
          'At',
          'Action',
          'Entity',
          'Entity id',
          'Actor',
          'Role',
          'IP',
          'Before',
          'After',
          'Summary',
        ],
        auditRowsToCsv(rows),
      ),
    );
  };

  const exportLogins = () => {
    downloadCsv(
      `${slugify('login-history')}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        ['Login at', 'Logout at', 'User', 'Role', 'Channel', 'IP', 'Client', 'Outcome', 'Detail'],
        logins.map((entry) => [
          entry.loginAt,
          entry.logoutAt ?? '',
          entry.userName,
          entry.role,
          entry.channel,
          entry.ip,
          entry.userAgent,
          entry.outcome,
          entry.detail,
        ]),
      ),
    );
  };

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'documents', label: 'Documents' },
    { key: 'digitization', label: 'Digitization' },
    { key: 'logins', label: 'Logins' },
    { key: 'issues', label: 'Issues' },
    ...(canSeeViews ? [{ key: 'views' as Tab, label: 'File views' }] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Administration"
        title="Audit trail"
        description="Every change is written in the same transaction as the change itself, so the trail cannot drift from the data it describes. Grouped by what the work touches; the file-view tab answers to its own permission."
        actions={
          <Button
            variant="ghost"
            icon={<DownloadSimple size={17} />}
            onClick={tab === 'logins' ? exportLogins : exportAudit}
          >
            Export CSV
          </Button>
        }
      />

      <div
        role="tablist"
        aria-label="Audit groups"
        className="flex w-full gap-1 overflow-x-auto rounded-xl border border-base bg-[var(--rr-surface)] p-1 sm:w-auto sm:self-start"
      >
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => {
              setTab(item.key);
              setAction('All');
              setOutcome('All');
            }}
            className={`focus-ring min-h-10 shrink-0 rounded-lg px-4 text-sm font-semibold transition ${
              tab === item.key
                ? 'bg-[var(--rr-accent-fill)] text-white'
                : 'muted hover:bg-[var(--rr-surface-2)] hover:text-[var(--rr-text)]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <Card padding={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-base p-4">
          <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
            <div className="relative">
              <MagnifyingGlass
                className="muted absolute left-3.5 top-1/2 -translate-y-1/2"
                size={16}
              />
              <TextInput
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Summary, entity, actor, IP…"
                className="pl-10"
                aria-label="Search audit entries"
              />
            </div>
            {tab === 'logins' ? (
              <SelectInput
                value={outcome}
                onChange={(event) => setOutcome(event.target.value as LoginOutcome | 'All')}
                aria-label="Filter by outcome"
              >
                {OUTCOMES.map((item) => (
                  <option key={item} value={item}>
                    {item === 'All' ? 'All outcomes' : item}
                  </option>
                ))}
              </SelectInput>
            ) : tab === 'views' ? (
              <span />
            ) : (
              <SelectInput
                value={action}
                onChange={(event) => setAction(event.target.value as AuditAction | 'All')}
                aria-label="Filter by action"
              >
                <option value="All">All actions</option>
                {AUDIT_ACTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </SelectInput>
            )}
          </div>
          <p className="muted shrink-0 text-xs">
            {tab === 'documents' && 'Registry files, maps, bulk imports, barcode jobs, departments'}
            {tab === 'digitization' && 'Scan pages, custody events, deliverable PDFs'}
            {tab === 'logins' && 'Sign-in history with channel, client and outcome'}
            {tab === 'issues' && 'The issue / return / movement trail'}
            {tab === 'views' && 'Who opened which record, and when'}
          </p>
        </div>

        {tab === 'views' ? (
          <ViewTable entries={views} loading={loadingViews} />
        ) : tab === 'logins' ? (
          <LoginTable logins={logins} loading={loadingLogins} />
        ) : (
          <EntryList entries={entries} loading={loadingEntries} />
        )}
      </Card>

      <Card>
        <div className="flex gap-3">
          <ShieldCheck size={20} className="mt-0.5 shrink-0 text-accent" />
          <p className="muted text-sm leading-6">
            This log is the API's own trail with server-side grouping. For 25 lakh files the
            authoritative store carries retention policy and tamper evidence — see{' '}
            <span className="font-mono text-xs">docs/SECURITY.md</span>. The file-view tab answers
            to the <span className="font-mono text-xs">audit.fileViews</span> permission, so an
            admin can grant exactly that view to a supervisor.
          </p>
        </div>
      </Card>
    </div>
  );
}

function EntryList({
  entries,
  loading,
  compact = false,
}: {
  entries: AuditEntry[];
  loading: boolean;
  compact?: boolean;
}) {
  if (entries.length === 0) {
    return (
      <div className={compact ? 'p-4' : 'p-6'}>
        <EmptyState
          title={loading ? 'Loading audit entries' : 'No audit entries match'}
          description={
            loading
              ? 'Asking the audit service for entries that match these filters.'
              : 'Clear the filters, or make a change on the issue, return or location screens to see a new entry.'
          }
        />
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--rr-border)]">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={
            compact
              ? 'grid gap-3 p-4 lg:grid-cols-[140px_1fr]'
              : 'grid gap-3 p-5 lg:grid-cols-[160px_1fr_1fr]'
          }
        >
          <div>
            <Badge tone={ACTION_TONE[entry.action]}>{entry.action}</Badge>
            <p className="muted mt-2 text-[11px]">{entry.at}</p>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{entry.summary}</p>
            <p className="muted mt-1 text-[11px]">
              {entry.entity} · <span className="font-mono">{entry.entityId}</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded bg-[var(--rr-bg)] px-2 py-1">
                actor <span className="font-semibold">{entry.actor}</span> ({entry.role})
              </span>
              <span className="rounded bg-[var(--rr-bg)] px-2 py-1">
                ip <span className="font-mono">{entry.ip}</span>
              </span>
            </div>
          </div>
          {!compact && (
            <div className="grid gap-2 text-[11px]">
              <div className="rounded-lg bg-[var(--rr-bg)] p-2">
                <p className="muted uppercase tracking-wider">Before</p>
                <p className="mt-0.5 font-mono">{entry.before}</p>
              </div>
              <div className="rounded-lg bg-accent-soft p-2">
                <p className="uppercase tracking-wider text-accent">After</p>
                <p className="mt-0.5 font-mono">{entry.after}</p>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function LoginTable({ logins, loading }: { logins: LoginHistoryEntry[]; loading: boolean }) {
  if (logins.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          title={loading ? 'Loading login attempts' : 'No login attempts match'}
          description={
            loading
              ? 'Asking the audit service for login attempts.'
              : 'Clear the filters to see the full history.'
          }
        />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-[var(--rr-bg)] text-xs uppercase tracking-wider muted">
          <tr>
            <th className="px-5 py-3">Login</th>
            <th className="px-5 py-3">Logout</th>
            <th className="px-5 py-3">User</th>
            <th className="px-5 py-3">Channel</th>
            <th className="px-5 py-3">IP</th>
            <th className="px-5 py-3">Outcome</th>
            <th className="px-5 py-3">Detail</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--rr-border)]">
          {logins.map((entry) => (
            <tr key={entry.id} className="hover:bg-[var(--rr-bg)]">
              <td className="px-5 py-3.5 text-xs muted">{entry.loginAt}</td>
              <td className="px-5 py-3.5 text-xs muted">{entry.logoutAt ?? '—'}</td>
              <td className="px-5 py-3.5">
                <p className="font-mono text-xs font-semibold">{entry.userName}</p>
                <p className="muted text-[11px]">{entry.role}</p>
              </td>
              <td className="px-5 py-3.5 text-xs">{entry.channel}</td>
              <td className="px-5 py-3.5 font-mono text-xs muted">{entry.ip}</td>
              <td className="px-5 py-3.5">
                <Badge
                  tone={
                    entry.outcome === 'Success'
                      ? 'success'
                      : entry.outcome === 'Failed'
                        ? 'danger'
                        : 'neutral'
                  }
                >
                  {entry.outcome}
                </Badge>
              </td>
              <td className="px-5 py-3.5 text-[11px] muted">{entry.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ViewTable({ entries, loading }: { entries: AuditEntry[]; loading: boolean }) {
  if (entries.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title={loading ? 'Loading the file-view trail' : 'No file views recorded yet'}
          description={
            loading
              ? 'Asking the audit service who opened which record.'
              : 'Opening a file page records a view here — the same person re-opening a file within five minutes counts once.'
          }
        />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-[var(--rr-bg)] text-xs uppercase tracking-wider muted">
          <tr>
            <th className="px-5 py-3">Opened at</th>
            <th className="px-5 py-3">Opened by</th>
            <th className="px-5 py-3">Role</th>
            <th className="px-5 py-3">File</th>
            <th className="px-5 py-3">IP</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--rr-border)]">
          {entries.map((entry) => (
            <tr key={entry.id} className="hover:bg-[var(--rr-bg)]">
              <td className="px-5 py-3.5 text-xs muted">{entry.at}</td>
              <td className="px-5 py-3.5 text-[13px] font-semibold">{entry.actor}</td>
              <td className="px-5 py-3.5 text-xs muted">{entry.role}</td>
              <td className="px-5 py-3.5 text-[13px]">{entry.summary}</td>
              <td className="px-5 py-3.5 font-mono text-xs muted">{entry.ip}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
