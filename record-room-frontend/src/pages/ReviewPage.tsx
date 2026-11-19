import { useState } from 'react';
import { CheckCircle, FilePdf } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { RowSkeleton } from '../components/ui/Skeletons';
import { TextInput } from '../components/ui/Field';
import { FilePagesPreview } from '../components/files/FilePagesPreview';
import { useQuery, useService, useSession } from '../hooks/useService';
import { formatPageNumbers } from '../lib/reviewGroup';
import type { ReviewFileGroup } from '../services/contracts';

/**
 * The Review section (round 5): the pending-review queue of the digitization
 * pipeline, one row per file. A page rescan, an added sheet or a rebuilt
 * deliverable no longer floods the table — the row shows the changed page
 * numbers and opens the full-file preview, where the changed pages are
 * highlighted and approved or rejected with a remark.
 *
 * Actions are gated on `digitization.review` (Supervisor and Admin by default);
 * everyone else sees the queue read-only.
 */
export function ReviewPage() {
  const service = useService();
  const { allowed } = useSession();
  const [search, setSearch] = useState('');
  const [openFileId, setOpenFileId] = useState<string | null>(null);

  const {
    data: groups,
    loading,
    reload,
  } = useQuery(
    () => service.digitization.pendingByFile({ search }),
    [search],
    [] as ReviewFileGroup[],
    ['digitization'],
  );

  const totalPages = groups.reduce((sum, group) => sum + group.pages.length, 0);
  const totalPdfs = groups.reduce((sum, group) => sum + group.pdfs.length, 0);

  // Derived from the live list so a decided file's preview refreshes in place
  // and closes itself when nothing of it is pending any more.
  const openGroup = openFileId
    ? (groups.find((group) => group.fileId === openFileId) ?? null)
    : null;

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
          <ul className="divide-y divide-[var(--rr-border)]">
            {groups.map((group) => (
              <li key={group.fileId} className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
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
                    <p className="mt-0.5 truncate text-sm font-medium">{group.subject}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                      {group.pages.length > 0 && (
                        <span className="flex items-center gap-1.5">
                          <span className="muted">Pages</span>
                          <span className="rounded-md bg-accent-soft px-1.5 py-0.5 font-mono font-semibold text-accent">
                            {formatPageNumbers(group.pages.map((page) => page.scan.pageNo))}
                          </span>
                          <span className="muted">({group.pages.length} changed)</span>
                        </span>
                      )}
                      {group.pdfs.length > 0 && (
                        <span className="flex items-center gap-1.5">
                          <FilePdf size={14} className="text-accent" />
                          <span className="font-semibold">
                            {group.pdfs.length} build{group.pdfs.length > 1 ? 's' : ''}
                          </span>
                          <span className="muted">awaiting approval</span>
                        </span>
                      )}
                      <span className="muted">
                        Updated {new Date(group.lastActivityAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {!allowed('digitization.review') && (
                      <span className="muted text-xs">Read-only</span>
                    )}
                    <Button
                      size="sm"
                      icon={<CheckCircle size={15} />}
                      onClick={() => setOpenFileId(group.fileId)}
                    >
                      Review
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={openGroup !== null}
        onClose={() => setOpenFileId(null)}
        title={
          openGroup ? `Review ${openGroup.fileNumber || openGroup.fileBarcode}` : 'Review file'
        }
        description={openGroup?.subject}
        size="xl"
      >
        {openGroup && (
          <FilePagesPreview
            key={openGroup.fileId}
            fileId={openGroup.fileId}
            fileLabel={openGroup.fileNumber || openGroup.fileBarcode}
            subject={openGroup.subject}
            canReview={allowed('digitization.review')}
            pendingPdfs={openGroup.pdfs}
            onReviewed={reload}
          />
        )}
      </Modal>
    </div>
  );
}
