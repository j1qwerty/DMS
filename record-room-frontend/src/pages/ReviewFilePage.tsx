import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle } from '@phosphor-icons/react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { FilePagesPreview } from '../components/files/FilePagesPreview';
import { StatusBadge } from '../components/ui/Flash';
import { useQuery, useService, useSession } from '../hooks/useService';
import type { ReviewFileGroup } from '../services/contracts';

/**
 * One file's review surface — the page the review queue opens (round 5,
 * reworked): pending deliverable builds, the full page grid with the changed
 * pages highlighted, and the decision bar, all on a real page with a URL
 * instead of a clipped modal. When nothing of this file is pending any more,
 * the page says so and offers the way back to the queue.
 */
export function ReviewFilePage() {
  const { fileId = '' } = useParams();
  const service = useService();
  const navigate = useNavigate();
  const { allowed } = useSession();
  const canReview = allowed('digitization.review');

  const {
    data: file,
    loading,
    reload: reloadFile,
  } = useQuery(() => service.files.get(fileId), [fileId], null, ['files']);

  const { data: groups, reload: reloadGroups } = useQuery(
    () => service.digitization.pendingByFile({}),
    [],
    [] as ReviewFileGroup[],
    ['digitization'],
  );

  const group = groups.find((row) => row.fileId === fileId) ?? null;

  if (!loading && !file) {
    return (
      <EmptyState
        title="File not found"
        description="That file is not in the registry any more."
        action={
          <Link to="/review" className="focus-ring text-sm font-semibold text-accent">
            Back to the review queue
          </Link>
        }
      />
    );
  }

  const label = group?.fileNumber || group?.fileBarcode || file?.fileNumber || fileId;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => navigate('/review')}
            className="focus-ring muted mb-2 inline-flex items-center gap-1.5 text-xs font-semibold hover:text-[var(--rr-text)]"
          >
            <ArrowLeft size={14} /> Review queue
          </button>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="mono text-xl font-bold tracking-tight md:text-2xl">Review {label}</h1>
            {file && <StatusBadge status={file.status} />}
            {group?.department && <Badge tone="neutral">{group.department}</Badge>}
            {!canReview && <Badge tone="warning">Read-only</Badge>}
          </div>
          <p className="muted mt-1 max-w-3xl text-sm leading-5">
            {group?.subject ?? file?.subject ?? ''}
          </p>
          <p className="muted mt-1 text-xs">
            Changed pages are highlighted; approve or reject them as one selection with a shared
            remark. Pending deliverable builds sit above the grid.{' '}
            <Link to={`/files/${fileId}`} className="focus-ring font-semibold text-accent">
              Open the file page
            </Link>
          </p>
        </div>
        <Link
          to="/review"
          className="focus-ring inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-base bg-[var(--rr-surface)] px-3 text-[13px] font-semibold hover:bg-[var(--rr-surface-2)]"
        >
          Back to queue
        </Link>
      </div>

      {!loading && !group ? (
        <Card>
          <EmptyState
            title="Review complete"
            description="Nothing of this file is pending any more — every change has been decided."
            action={
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ArrowLeft size={15} />}
                  onClick={() => navigate('/review')}
                >
                  Back to the queue
                </Button>
                <Link
                  to={`/files/${fileId}`}
                  className="focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-base bg-[var(--rr-surface)] px-3 text-[13px] font-semibold hover:bg-[var(--rr-surface-2)]"
                >
                  Open the file page
                </Link>
              </div>
            }
          />
        </Card>
      ) : (
        <FilePagesPreview
          key={fileId}
          fileId={fileId}
          fileLabel={label}
          subject={group?.subject ?? file?.subject ?? ''}
          canReview={canReview}
          pendingPdfs={group?.pdfs ?? []}
          onReviewed={() => {
            reloadGroups();
            reloadFile();
          }}
        />
      )}

      {!canReview && group && (
        <p className="muted flex items-center gap-2 text-xs">
          <CheckCircle size={14} /> You see the queue read-only — deciding pages needs the
          digitization review permission.
        </p>
      )}
    </div>
  );
}
