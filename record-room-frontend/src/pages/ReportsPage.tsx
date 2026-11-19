import { useEffect, useRef, useState } from 'react';
import { DownloadSimple, Table } from '@phosphor-icons/react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Pagination } from '../components/ui/Pagination';
import { RowSkeleton } from '../components/ui/Skeletons';
import { useFlash, useQuery, useService, useSession } from '../hooks/useService';
import { exportReport } from '../services';
import { cn } from '../lib/utils';
import type { ReportDefinition, ReportKey } from '../types';
import type { ReportResult } from '../services/contracts';

const PAGE_SIZE = 12;

/**
 * Reports, redesigned: no card gallery — one tab per report, the table right
 * under it. A tab builds its report on demand (and keeps it cached), so the
 * page never compiles the whole registry to decide what to show. Exports stay
 * CSV and audited, exactly as before.
 */
export function ReportsPage() {
  const service = useService();
  const { allowed } = useSession();
  const { success, danger } = useFlash();

  const { data: definitions } = useQuery(
    () => service.reports.definitions(),
    [],
    [] as ReportDefinition[],
  );

  const [active, setActive] = useState<ReportKey | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [building, setBuilding] = useState(false);
  const [page, setPage] = useState(1);

  // Built reports stay cached for the visit; switching tabs is instant unless
  // the report has not been built yet.
  const cache = useRef(new Map<ReportKey, ReportResult>());

  const build = async (key: ReportKey) => {
    const cached = cache.current.get(key);
    if (cached) {
      setActive(key);
      setResult(cached);
      setPage(1);
      return;
    }
    setActive(key);
    setResult(null);
    setBuilding(true);
    try {
      const built = await service.reports.build(key);
      cache.current.set(key, built);
      // A slow response for an earlier tab must not overwrite the current one.
      if (active === key) {
        setResult(built);
        setPage(1);
      }
    } catch (e) {
      danger(e instanceof Error ? e.message : 'The report could not be built.');
    } finally {
      setBuilding(false);
    }
  };

  // The first tab opens once the definitions arrive.
  const primed = useRef(false);
  useEffect(() => {
    if (definitions.length === 0 || primed.current) return;
    primed.current = true;
    const first = definitions[0];
    if (first) void build(first.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitions]);

  const runExport = async () => {
    if (!active) return;
    const built = await exportReport(active);
    success(
      `${built.definition.title} exported with ${built.rows.length} row(s). The export is on the audit trail.`,
    );
  };

  const rows = result ? result.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];
  const activeDefinition = definitions.find((def) => def.key === active);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="Built live from the same data the desks write — pick a tab, read the table, export CSV."
        actions={
          allowed('reports.export') && (
            <Button icon={<DownloadSimple size={17} />} onClick={runExport} disabled={!result}>
              Export CSV
            </Button>
          )
        }
      />

      {/* One tab per report kind; the table follows directly. */}
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-xl border border-base bg-[var(--rr-bg)] p-1.5">
        {definitions.map((definition) => (
          <button
            key={definition.key}
            type="button"
            onClick={() => void build(definition.key)}
            title={definition.description}
            className={cn(
              'focus-ring inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold transition',
              active === definition.key
                ? 'bg-[var(--rr-accent-fill)] text-white shadow-sm'
                : 'text-[var(--rr-muted)] hover:bg-[var(--rr-surface-2)] hover:text-[var(--rr-text)]',
            )}
          >
            {definition.title}
          </button>
        ))}
        {definitions.length === 0 && <span className="muted p-2 text-xs">Loading reports…</span>}
      </div>

      <Card padding={false} className="overflow-hidden">
        {/* table header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-base px-5 py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Table size={16} className="text-accent" />
              {activeDefinition?.title ?? '—'}
            </p>
            <p className="muted mt-0.5 truncate text-xs">
              {activeDefinition?.description ?? ''}
              {result
                ? ` · ${result.rows.length} row(s) · generated ${new Date(result.generatedAt).toLocaleString()}`
                : ''}
            </p>
          </div>
          {result && (
            <Badge tone="neutral">{result.definition.legacySource.split('·')[0].trim()}</Badge>
          )}
        </div>

        {building || (!result && active) ? (
          <div className="p-4">
            <RowSkeleton rows={6} />
          </div>
        ) : !active ? (
          <div className="p-6">
            <EmptyState
              title="Pick a report"
              description="Choose a tab above to build its table from live data."
            />
          </div>
        ) : !result || result.rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No rows for this report"
              description="There is nothing to report on yet — the tables fill as the desks write data."
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-base text-xs uppercase tracking-wider text-[var(--rr-muted)]">
                    {result.columns.map((column) => (
                      <th key={column} className="px-4 py-3 font-semibold">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--rr-border)]">
                  {rows.map((row, index) => (
                    <tr
                      key={`${active}-${(page - 1) * PAGE_SIZE + index}`}
                      className="transition hover:bg-[var(--rr-surface-2)]"
                    >
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className={cn(
                            'px-4 py-3 text-[13px]',
                            cellIndex === 0 && 'font-semibold',
                          )}
                        >
                          {String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-base p-4">
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={result.rows.length}
                onPage={setPage}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
