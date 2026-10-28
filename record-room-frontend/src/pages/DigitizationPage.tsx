import { useState, type ReactNode } from 'react';
import { CheckCircle, Scan, WarningCircle, XCircle } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Field, TextArea, TextInput } from '../components/ui/Field';
import { Flash } from '../components/ui/Flash';
import { EmptyState } from '../components/ui/EmptyState';
import { useQuery, useService, useSession } from '../hooks/useService';
import type { FileScan } from '../types';

/**
 * File-centric digitization (2026-10-28 decision): the Digitization section is
 * the pending-review queue across files. Pages are added from the file page;
 * here a supervisor reviews them — approve, or reject with a reason.
 */
export function DigitizationPage() {
  const service = useService();
  const { allowed } = useSession();

  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState('');
  const [rejecting, setRejecting] = useState<FileScan | null>(null);
  const [flash, setFlash] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  // The API owns the filtering; the rows on screen are exactly the pending
  // queue for the current search. Live updates from other screens arrive on
  // the 'digitization' channel.
  const {
    data: queue,
    loading,
    reload,
  } = useQuery(() => service.digitization.pending({ search }), [search], [] as FileScan[], [
    'digitization',
  ]);

  const review = async (scan: FileScan, decision: 'Approved' | 'Rejected', note = '') => {
    setBusyId(scan.id);
    try {
      const result = await service.digitization.review(scan.id, decision, note);
      if (!result.ok) {
        setFlash({ tone: 'danger', text: result.error });
        return;
      }
      setFlash({ tone: 'success', text: `${scan.filename} ${decision.toLowerCase()}.` });
      reload();
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-7">
      <PageHeader
        kicker="Digitization"
        title="Scan review queue"
        description="Every page scan awaiting review, across all files. Pages are added from their file; approving here marks the page complete for the registry."
      />

      {flash && <Flash tone={flash.tone} text={flash.text} onDismiss={() => setFlash(null)} />}

      <div className="grid gap-4 md:grid-cols-2">
        <Metric icon={<Scan />} label="In queue" value={String(queue.length)} />
        <Metric
          icon={<WarningCircle />}
          label="Reviewer"
          value={allowed('digitization.review') ? 'Supervisor+ only' : 'Read-only for you'}
          tone="warning"
          hint="Approve, or reject with a reason."
        />
      </div>

      <Card padding={false} className="overflow-hidden">
        <div className="border-b border-base p-4">
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="File barcode, file number or scan name…"
            aria-label="Search the review queue"
          />
        </div>

        {queue.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={loading ? 'Loading the queue' : 'Nothing awaits review'}
              description={
                loading
                  ? 'Asking the digitization register for pending pages.'
                  : 'Add page scans from a file page; they appear here for review.'
              }
              action={
                <Link to="/files" className="focus-ring text-xs font-semibold text-accent">
                  Open the registry
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--rr-border)]">
            {queue.map((scan) => (
              <li key={scan.id} className="p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="break-all font-semibold">{scan.filename}</p>
                    <p className="muted mt-1 text-[11px]">
                      Page {scan.pageNo} · v{scan.version} · {scan.documentSize} · uploaded{' '}
                      {scan.uploadedAt} by {scan.uploadedBy}
                    </p>
                    <p className="muted mt-1 text-[11px]">
                      File{' '}
                      <Link
                        to={`/files/${scan.fileId}`}
                        className="focus-ring font-mono text-accent"
                      >
                        {scan.fileNumber || scan.fileBarcode}
                      </Link>{' '}
                      · {scan.fileBarcode}
                    </p>
                    {scan.note && <p className="muted mt-1 text-[11px]">{scan.note}</p>}
                  </div>
                  {allowed('digitization.review') && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        icon={<CheckCircle size={16} />}
                        disabled={busyId === scan.id}
                        onClick={() => void review(scan, 'Approved')}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="ghost"
                        icon={<XCircle size={16} />}
                        disabled={busyId === scan.id}
                        onClick={() => setRejecting(scan)}
                      >
                        Reject…
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={`Reject ${rejecting?.filename ?? ''}`}
      >
        {rejecting && (
          <RejectForm
            onSubmit={async (note) => {
              await review(rejecting, 'Rejected', note);
              setRejecting(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'warning';
}) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <div
          className={`rounded-lg p-2 ${tone === 'warning' ? 'text-[var(--rr-warning)]' : 'text-accent'}`}
          style={
            tone === 'warning'
              ? { background: 'color-mix(in srgb, var(--rr-warning) 12%, transparent)' }
              : undefined
          }
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="muted text-[10px] uppercase tracking-wider">{label}</p>
          <p className="mt-1 text-xl font-semibold">{value}</p>
          {hint && <p className="muted mt-0.5 text-[10px]">{hint}</p>}
        </div>
      </div>
    </Card>
  );
}

function RejectForm({ onSubmit }: { onSubmit: (note: string) => void }) {
  const [note, setNote] = useState('');

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(note);
      }}
    >
      <Field label="Rejection reason" htmlFor="reject-note" required>
        <TextArea
          id="reject-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Skew beyond tolerance, missing half the page…"
        />
      </Field>
      <Button type="submit" disabled={!note.trim()}>
        Reject page
      </Button>
    </form>
  );
}
