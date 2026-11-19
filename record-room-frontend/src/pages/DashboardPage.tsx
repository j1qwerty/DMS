import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle,
  ClipboardText,
  Clock,
  Files,
  MapPin,
  Package,
  Archive,
  WarningCircle,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { PageHeader } from '../components/ui/PageHeader';
import { LinkButton } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useQuery, useService, useSession } from '../hooks/useService';
import { formatNumber } from '../lib/utils';
import { hideFileIds, useFeatures } from '../lib/features';
import type { DashboardStats, IssueRecord, Room, TimelineEvent } from '../types';
import type { Page } from '../services/contracts';
import type { RecordFile } from '../types';
import type { Channel } from '../services/realtime';

/** Nothing here may claim a figure the service has not reported yet. */
const EMPTY_STATS: DashboardStats = {
  totalRecords: 0,
  mappedPercent: 0,
  issuedNow: 0,
  dueToday: 0,
  digitizationPercent: 0,
  overdueCount: 0,
  roomCount: 0,
  activeBorrowers: 0,
  pendingApprovals: 0,
};
const EMPTY_TIMELINE: TimelineEvent[] = [];
const EMPTY_ISSUES: IssueRecord[] = [];
const EMPTY_ROOMS: Room[] = [];
const EMPTY_FILES: Page<RecordFile> = { items: [], total: 0, page: 1, pageSize: 1 };
const CHANNELS: Channel[] = ['files', 'issues', 'movements', 'digitization'];

function fillOf(room: Room) {
  const shelves = room.storageUnits.flatMap((unit) => unit.shelves);
  const capacity = shelves.reduce((sum, shelf) => sum + shelf.capacity, 0);
  const used = shelves.reduce((sum, shelf) => sum + shelf.occupied, 0);
  return capacity > 0 ? used / capacity : 0;
}

function Stat({
  label,
  value,
  note,
  to,
  icon: StatIcon,
}: {
  label: string;
  value: string;
  note: string;
  to: string;
  icon: Icon;
}) {
  return (
    <Link
      to={to}
      className="focus-ring surface-flat flex items-start gap-4 rounded-xl p-4 transition hover:border-[var(--rr-accent)]"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
        <StatIcon size={22} />
      </span>
      <span className="min-w-0">
        <span className="muted block text-[13px]">{label}</span>
        <span className="block text-2xl font-bold leading-tight tracking-[-0.02em]">{value}</span>
        <span className="muted block text-xs">{note}</span>
      </span>
    </Link>
  );
}

/** Overview: a quick read on the registry, not the place work gets done. */
export function DashboardPage() {
  const service = useService();
  const { allowed } = useSession();
  const { barcode } = useFeatures();

  const { data: stats } = useQuery(() => service.dashboard.stats(), [], EMPTY_STATS, CHANNELS);
  const { data: activity } = useQuery(() => service.dashboard.activity(6), [], EMPTY_TIMELINE, [
    'movements',
  ]);
  const { data: overdue } = useQuery(() => service.issues.overdue(), [], EMPTY_ISSUES, ['issues']);
  const { data: rooms } = useQuery(() => service.locations.listRooms(), [], EMPTY_ROOMS, [
    'locations',
    'files',
  ]);
  const { data: registry } = useQuery(() => service.files.list({ pageSize: 1 }), [], EMPTY_FILES, [
    'files',
  ]);
  const { data: missing } = useQuery(
    () => service.files.list({ status: 'Missing', pageSize: 1 }),
    [],
    EMPTY_FILES,
    ['files'],
  );

  const todo: Array<{ key: string; icon: Icon; tone: string; text: string; to: string }> = [];
  if (overdue.length > 0)
    todo.push({
      key: 'overdue',
      icon: WarningCircle,
      tone: 'text-[var(--rr-danger)]',
      text: `${overdue.length} overdue ${overdue.length === 1 ? 'receipt' : 'receipts'} to chase`,
      to: '/return',
    });
  if (missing.total > 0)
    todo.push({
      key: 'missing',
      icon: WarningCircle,
      tone: 'text-[var(--rr-danger)]',
      text: `${missing.total} ${missing.total === 1 ? 'file is' : 'files are'} marked missing`,
      to: '/files?status=Missing',
    });
  if (stats.dueToday > 0)
    todo.push({
      key: 'due',
      icon: Clock,
      tone: 'text-[var(--rr-warning)]',
      text: `${stats.dueToday} ${stats.dueToday === 1 ? 'receipt' : 'receipts'} due today or earlier`,
      to: '/return',
    });
  if (stats.pendingApprovals > 0 && allowed('digitization.review'))
    todo.push({
      key: 'review',
      icon: Archive,
      tone: 'text-accent',
      text: `${stats.pendingApprovals} scanned ${stats.pendingApprovals === 1 ? 'page' : 'pages'} waiting for review`,
      to: '/review',
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="How the registry looks right now."
        actions={
          <>
            {allowed('issue.issue') && (
              <LinkButton to="/issue" variant="ghost" icon={<ClipboardText size={17} />}>
                Issue files
              </LinkButton>
            )}
            {allowed('issue.return') && (
              <LinkButton to="/return" variant="ghost" icon={<Package size={17} />}>
                Return files
              </LinkButton>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          icon={Files}
          label="Files in registry"
          value={formatNumber(registry.collectionTotal ?? registry.total ?? stats.totalRecords)}
          note="All physical records"
          to="/files"
        />
        <Stat
          icon={MapPin}
          label="Files mapped"
          value={`${stats.mappedPercent}%`}
          note={`${stats.roomCount} room${stats.roomCount === 1 ? '' : 's'}`}
          to="/rooms"
        />
        <Stat
          icon={ClipboardText}
          label="Files issued"
          value={formatNumber(stats.issuedNow)}
          note={`${stats.activeBorrowers} borrower${stats.activeBorrowers === 1 ? '' : 's'}`}
          to="/files?status=Issued"
        />
        <Stat
          icon={Clock}
          label="Files due"
          value={formatNumber(stats.dueToday)}
          note={`${stats.overdueCount} overdu${stats.overdueCount === 1 ? 'e' : 'es'}`}
          to="/files?status=Issued"
        />
        <Stat
          icon={Archive}
          label="Digitization"
          value={`${stats.digitizationPercent}%`}
          note={`${stats.pendingApprovals} waiting for review`}
          to="/digitization"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          <Card padding={false}>
            <div className="border-b border-base px-4 py-3">
              <h2 className="text-sm font-bold">To do</h2>
            </div>
            {todo.length === 0 ? (
              <p className="flex items-center gap-2.5 p-4 text-sm">
                <CheckCircle size={20} weight="fill" className="text-[var(--rr-success)]" />
                Nothing needs attention.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--rr-border)]">
                {todo.map((item) => (
                  <li key={item.key}>
                    <Link
                      to={item.to}
                      className="focus-ring flex min-h-12 items-center gap-3 px-4 py-3 text-sm hover:bg-[var(--rr-bg)]"
                    >
                      <item.icon size={20} weight="fill" className={`shrink-0 ${item.tone}`} />
                      <span className="flex-1">{item.text}</span>
                      <ArrowRight size={15} className="muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card padding={false}>
            <div className="flex items-center justify-between border-b border-base px-4 py-3">
              <h2 className="text-sm font-bold">Latest movement</h2>
              <Link
                to="/movement"
                className="focus-ring rounded text-[13px] font-semibold text-accent"
              >
                Full log
              </Link>
            </div>
            {activity.length === 0 ? (
              <p className="muted p-4 text-sm">No movement recorded yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--rr-border)]">
                {activity.map((event) => (
                  <li key={event.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-semibold">{event.label}</p>
                      <span className="muted shrink-0 text-xs">{event.date}</span>
                    </div>
                    <p className="muted mt-0.5 text-[13px] leading-5">
                      {hideFileIds(event.detail, barcode)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card padding={false} className="self-start">
          <div className="flex items-center justify-between border-b border-base px-4 py-3">
            <h2 className="text-sm font-bold">Rooms</h2>
            <Link to="/rooms" className="focus-ring rounded text-[13px] font-semibold text-accent">
              Manage
            </Link>
          </div>
          {rooms.length === 0 ? (
            <p className="muted p-4 text-sm">No rooms yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--rr-border)]">
              {rooms.map((room) => {
                const fill = Math.round(fillOf(room) * 100);
                return (
                  <li key={room.id}>
                    <Link
                      to={`/rooms/${room.id}`}
                      className="focus-ring block px-4 py-3 hover:bg-[var(--rr-bg)]"
                    >
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-semibold">{room.name}</span>
                        <span className="muted text-[13px]">{fill}% full</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--rr-surface-2)]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${fill}%`,
                            background: fill >= 90 ? 'var(--rr-danger)' : 'var(--rr-accent)',
                          }}
                        />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
