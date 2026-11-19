import { useState } from 'react';
import { ArrowRight, CheckCircle, FilePdf } from '@phosphor-icons/react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { RowSkeleton } from '../components/ui/Skeletons';
import { TextInput } from '../components/ui/Field';
import { useQuery, useService, useSession } from '../hooks/useService';
import { formatPageNumbers } from '../lib/reviewGroup';
import type { ReviewFileGroup } from '../services/contracts';

/**
 * The Review section (round 5): the pending-review queue of the digitization
 * pipeline, one row per file. A page rescan, an added sheet or a rebuilt
 * deliverable folds into that file's single row, so one file with changes on
 * many pages is one reviewable unit — the row shows the changed page numbers.
 *
 * Clicking Review opens the file's own review page (/review/:fileId) — the
 * whole viewport for the page grid, a URL to share, the browser's back button.
 *
 * Actions are gated on `digitization.review` (Supervisor and Admin by default);
 * everyone else sees the queue read-only.
 */
export function ReviewPage() {
  const service = useService();
  const { allowed } = useSession();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const { data: groups, loading } = useQuery(
    () => service.digitization.pendingByFile({ search }),
    [search],
    [] as ReviewFileGroup[],
    ['digitization'],
  );

  const totalPages = groups.reduce((sum, group) => sum + group.pages.length, 0);
  const totalPdfs = groups.reduce((sum, group) => sum + group.pdfs.length, 0);
  const canReview = allowed('digitization.review');

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Review</h1>
          <p className="muted mt-1 text-sm">
            {groups.length > 0
              ? `${groups.length} file(s) · ${totalPages} changed page(s) · ${totalPdfs} build(s)`
              : 'Page changes and deliverable builds awaiting sign-off'}
          </p>
        </div>
        <div className="sm:w-72">
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="File number, barcode or subject…"
            aria-label="Search the review queue"
          />
        </div>
      </div>

      <Card padding={false} className="overflow-hidden">
        {loading && groups.length === 0 ? (
          <div className="p-4">
            <RowSkeleton rows={4} />
          </div>
        ) : groups.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Nothing to review"
              description={
                search
                  ? 'No file matches this search.'
                  : 'Changes land here the moment an operator scans, replaces or rearranges a page, or builds a deliverable.'
              }
            />
          </div>
        ) : (
          <>
            {/* Desktop: a real queue table — file, what changed, when, action. */}
            <table className="hidden w-full text-left text-sm md:table">
              <thead>
                <tr className="border-b border-base text-left text-xs uppercase tracking-wider text-[var(--rr-muted)]">
                  <th className="px-5 py-3 font-semibold">File</th>
                  <th className="px-3 py-3 font-semibold">Changes</th>
                  <th className="px-3 py-3 font-semibold">Builds</th>
                  <th className="px-3 py-3 font-semibold">Updated</th>
                  <th className="px-5 py-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--rr-border)]">
                {groups.map((group) => (
                  <tr
                    key={group.fileId}
                    className="cursor-pointer transition hover:bg-[var(--rr-surface-2)]"
                    onClick={() => navigate(`/review/${group.fileId}`)}
                  >
                    <td className="max-w-[22rem] px-5 py-3.5">
                      <Link
                        to={`/files/${group.fileId}`}
                        onClick={(event) => event.stopPropagation()}
                        className="focus-ring font-mono text-[13px] font-semibold text-accent"
                      >
                        {group.fileNumber || group.fileBarcode}
                      </Link>
                      {group.department && (
                        <Badge tone="neutral">
                          <span className="ml-0 mt-1 inline-block">{group.department}</span>
                        </Badge>
                      )}
                      <p className="muted mt-0.5 truncate text-xs">{group.subject}</p>
                    </td>
                    <td className="px-3 py-3.5 align-top">
                      {group.pages.length > 0 ? (
                        <div className="space-y-1">
                          <span className="rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-xs font-semibold text-accent">
                            {formatPageNumbers(group.pages.map((page) => page.scan.pageNo))}
                          </span>
                          <p className="muted text-xs">{group.pages.length} changed page(s)</p>
                        </div>
                      ) : (
                        <span className="muted text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 align-top">
                      {group.pdfs.length > 0 ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                          <FilePdf size={14} className="text-accent" />
                          {group.pdfs.length} awaiting approval
                        </span>
                      ) : (
                        <span className="muted text-xs">—</span>
                      )}
                    </td>
                    <td className="muted px-3 py-3.5 align-top text-xs">
                      {new Date(group.lastActivityAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 text-right align-top">
                      {canReview ? (
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent">
                          Review <ArrowRight size={14} />
                        </span>
                      ) : (
                        <span className="muted text-xs">Read-only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Phone: card rows with the same information. */}
            <ul className="divide-y divide-[var(--rr-border)] md:hidden">
              {groups.map((group) => (
                <li key={group.fileId} className="p-4">
                  <div className="flex flex-col gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/files/${group.fileId}`}
                          className="focus-ring font-mono text-[13px] font-semibold text-accent"
                        >
                          {group.fileNumber || group.fileBarcode}
                        </Link>
                        {group.department && <Badge tone="neutral">{group.department}</Badge>}
                      </div>
                      <p className="muted mt-0.5 truncate text-xs">{group.subject}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                        {group.pages.length > 0 && (
                          <span className="flex items-center gap-1.5">
                            <span className="muted">Pages</span>
                            <span className="rounded-md bg-accent-soft px-1.5 py-0.5 font-mono font-semibold text-accent">
                              {formatPageNumbers(group.pages.map((page) => page.scan.pageNo))}
                            </span>
                          </span>
                        )}
                        {group.pdfs.length > 0 && (
                          <span className="flex items-center gap-1.5">
                            <FilePdf size={14} className="text-accent" />
                            <span className="font-semibold">
                              {group.pdfs.length} build{group.pdfs.length > 1 ? 's' : ''}
                            </span>
                          </span>
                        )}
                        <span className="muted">
                          {new Date(group.lastActivityAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      {canReview ? null : <span className="muted text-xs">Read-only</span>}
                      <button
                        type="button"
                        onClick={() => navigate(`/review/${group.fileId}`)}
                        className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-base bg-[var(--rr-surface)] px-3 py-1.5 text-[13px] font-semibold hover:bg-[var(--rr-surface-2)]"
                      >
                        <CheckCircle size={15} className="text-accent" />
                        Review
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
