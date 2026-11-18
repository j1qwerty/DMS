import { useState } from 'react';
import { DownloadSimple, Package, SealCheck, XCircle } from '@phosphor-icons/react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Field, TextArea, TextInput } from '../components/ui/Field';
import { TableSkeleton } from '../components/ui/Skeletons';
import { useFlash, useQuery, useService, useSession } from '../hooks/useService';
import { dataSource } from '../services';
import type { DigitalHandoverBatch, RecordFile } from '../types';
import type { Page } from '../services/contracts';

const EMPTY_HANDOVERS: DigitalHandoverBatch[] = [];
const EMPTY_FILES: Page<RecordFile> = { items: [], total: 0, page: 1, pageSize: 100 };

function statusTone(status: DigitalHandoverBatch['status']) {
  if (status === 'Accepted') return 'success';
  if (status === 'Rejected') return 'danger';
  if (status === 'Delivered') return 'info';
  return 'warning';
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Department-facing digital package manifest, delivery record and receiver sign-off. */
export function DigitalHandoverPanel() {
  const service = useService();
  const { allowed } = useSession();
  const { success, danger } = useFlash();
  const mayManage = allowed('custody.manage');

  const { data: handovers, loading, reload } = useQuery(
    () => service.digitalHandovers.list(),
    [],
    EMPTY_HANDOVERS,
    ['digitization'],
  );
  const { data: registry, loading: filesLoading } = useQuery(
    () => service.files.list({
      page: 1,
      pageSize: 100,
      search: fileSearch.trim() || undefined,
    }),
    [fileSearch],
    EMPTY_FILES,
    ['files'],
  );

  const [batchRef, setBatchRef] = useState('');
  const [department, setDepartment] = useState('');
  const [notes, setNotes] = useState('');
  const [fileSearch, setFileSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [receiverByBatch, setReceiverByBatch] = useState<Record<string, string>>({});
  const [notesByBatch, setNotesByBatch] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  const toggleFile = (fileId: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked ? [...current, fileId] : current.filter((id) => id !== fileId),
    );
  };

  const prepare = async () => {
    if (!batchRef.trim() || !department.trim() || selectedIds.length === 0 || preparing) return;
    setPreparing(true);
    try {
      const result = await service.digitalHandovers.prepare({
        batchRef: batchRef.trim(),
        department: department.trim(),
        fileIds: selectedIds.map(Number),
        notes: notes.trim(),
      });
      if (!result.ok) {
        danger(result.error);
        return;
      }
      success(`Digital handover ${result.value.batchRef} prepared with ${result.value.itemCount} file(s).`);
      setBatchRef('');
      setDepartment('');
      setNotes('');
      setSelectedIds([]);
      reload();
    } finally {
      setPreparing(false);
    }
  };

  const markDelivered = async (batch: DigitalHandoverBatch) => {
    setBusyId(batch.id);
    try {
      const result = await service.digitalHandovers.markDelivered(batch.id);
      if (!result.ok) {
        danger(result.error);
        return;
      }
      success(`Handover ${batch.batchRef} marked as delivered.`);
      reload();
    } finally {
      setBusyId(null);
    }
  };

  const signOff = async (batch: DigitalHandoverBatch, decision: 'Accepted' | 'Rejected') => {
    const receiver = receiverByBatch[batch.id]?.trim() ?? '';
    const note = notesByBatch[batch.id]?.trim() ?? '';
    if (!receiver) {
      danger('Enter the receiving department representative.');
      return;
    }
    if (decision === 'Rejected' && !note) {
      danger('A rejection reason is required.');
      return;
    }
    setBusyId(batch.id);
    try {
      const result = await service.digitalHandovers.signOff(batch.id, decision, receiver, note);
      if (!result.ok) {
        danger(result.error);
        return;
      }
      success(`Department ${decision.toLowerCase()} the digital handover.`);
      reload();
    } finally {
      setBusyId(null);
    }
  };

  const downloadPackage = async (batch: DigitalHandoverBatch) => {
    setBusyId(batch.id);
    try {
      const blob = await service.digitalHandovers.packageBlob(batch.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `digital-handover-${batch.batchRef}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      success(`Downloaded package for ${batch.batchRef}.`);
    } catch (error) {
      danger(error instanceof Error ? error.message : 'The package could not be downloaded.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="digital-handover-heading">
      <div>
        <div className="flex items-center gap-2">
          <Package size={20} className="text-accent" />
          <h2 id="digital-handover-heading" className="text-lg font-bold">Digital deliverables handover</h2>
        </div>
        <p className="muted mt-1 text-sm">
          Prepare a checksum-backed manifest from generated final PDFs, download the package and record the receiving Department representative’s acceptance.
        </p>
      </div>

      {dataSource === 'local' ? (
        <Card>
          <p className="text-sm font-semibold">Connect the SQL Server API to use digital handover.</p>
          <p className="muted mt-1 text-sm">The local sample does not contain authoritative final-PDF storage or departmental sign-off records, so it does not simulate these receipts.</p>
        </Card>
      ) : null}

      {mayManage && (
        <Card className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Prepare a new handover batch</h3>
            <p className="muted mt-1 text-xs">Every selected file must have a stored generated Final PDF. A batch can contain at most 100 files from one Department.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Batch reference" htmlFor="digital-handover-ref" required>
              <TextInput id="digital-handover-ref" value={batchRef} onChange={(event) => setBatchRef(event.target.value)} maxLength={64} placeholder="e.g. ZP-DIG-2026-001" />
            </Field>
            <Field label="Department" htmlFor="digital-handover-department" required>
              <TextInput id="digital-handover-department" value={department} onChange={(event) => setDepartment(event.target.value)} maxLength={128} placeholder="Receiving department" />
            </Field>
          </div>
          <Field label="Handover notes" htmlFor="digital-handover-notes">
            <TextArea id="digital-handover-notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="Optional notes or agreed deliverable reference" />
          </Field>
          <div>
            <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">Select files</p>
              <Badge tone={selectedIds.length > 0 ? 'info' : 'neutral'}>{selectedIds.length} selected</Badge>
            </div>
            <Field label="Search by file number, subject or department" htmlFor="digital-handover-file-search">
              <TextInput
                id="digital-handover-file-search"
                value={fileSearch}
                onChange={(event) => setFileSearch(event.target.value)}
                placeholder="Search the registry"
              />
            </Field>
            {filesLoading ? (
              <p className="muted py-3 text-sm">Searching the registry…</p>
            ) : registry.items.length === 0 ? (
              <p className="muted text-sm">No file records are available in the current registry page.</p>
            ) : (
              <>
                <div className="max-h-64 overflow-y-auto rounded-lg border border-base">
                {registry.items.map((file) => (
                  <label key={file.id} className="flex cursor-pointer items-start gap-3 border-b border-base px-3 py-2.5 last:border-b-0 hover:bg-[var(--rr-bg)]">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(file.id)}
                      onChange={(event) => toggleFile(file.id, event.target.checked)}
                      className="mt-1 size-4 accent-[var(--rr-accent)]"
                      disabled={selectedIds.length >= 100 && !selectedIds.includes(file.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{file.fileNumber}</span>
                      <span className="muted block truncate text-xs">{file.subject} · {file.department}</span>
                    </span>
                  </label>
                ))}
                </div>
                {registry.total > registry.items.length && (
                  <p className="muted mt-1 text-xs">
                    Showing the first {registry.items.length} matching record(s). Refine the search to locate other files.
                  </p>
                )}
              </>
            )}
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void prepare()} disabled={!batchRef.trim() || !department.trim() || selectedIds.length === 0 || preparing}>
              {preparing ? 'Preparing manifest…' : 'Prepare digital handover'}
            </Button>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {loading && handovers.length === 0 ? (
          <Card><TableSkeleton rows={2} columns={[1.2, 1, 0.9, 0.8]} /></Card>
        ) : handovers.length === 0 ? (
          <Card><EmptyState title="No digital handovers yet" description="Prepared digital packages and Department acceptance records will appear here." /></Card>
        ) : (
          handovers.map((batch) => (
            <Card key={batch.id} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-all text-sm font-bold">{batch.batchRef}</p>
                  <p className="muted mt-0.5 text-xs">{batch.department} · {batch.itemCount} file(s) · prepared {batch.preparedAt} by {batch.preparedBy}</p>
                </div>
                <Badge tone={statusTone(batch.status)}>{batch.status}</Badge>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <span><span className="muted">Manifest SHA-256:</span> <code>{batch.manifestSha256}</code></span>
                {batch.deliveredAt && <span><span className="muted">Delivered:</span> {batch.deliveredAt} by {batch.deliveredBy}</span>}
                {batch.signedOffAt && <span><span className="muted">Department sign-off:</span> {batch.signedOffAt} by {batch.signedOffBy}</span>}
              </div>
              <div className="divide-y divide-[var(--rr-border)] rounded-lg border border-base">
                {batch.items.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{item.fileNumber}</p>
                      <p className="muted break-all text-xs">{item.filename} · v{item.version} · {item.pageCount ?? '—'} page(s) · {formatBytes(item.sizeBytes)}</p>
                    </div>
                    <span className="muted font-mono text-[10px]">{item.sha256.slice(0, 16)}…</span>
                  </div>
                ))}
              </div>
              {batch.status === 'Prepared' && mayManage && (
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => void markDelivered(batch)} disabled={busyId === batch.id} icon={<Package size={16} />}>
                    {busyId === batch.id ? 'Recording…' : 'Mark package delivered'}
                  </Button>
                </div>
              )}
              {batch.status === 'Delivered' && mayManage && (
                <div className="grid gap-3 rounded-lg border border-base p-3">
                  <p className="text-sm font-semibold">Department acceptance</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Receiving representative" htmlFor={`handover-receiver-${batch.id}`} required>
                      <TextInput
                        id={`handover-receiver-${batch.id}`}
                        value={receiverByBatch[batch.id] ?? ''}
                        onChange={(event) => setReceiverByBatch((current) => ({ ...current, [batch.id]: event.target.value }))}
                        placeholder="Name and designation"
                      />
                    </Field>
                    <Field label="Acceptance / exception notes" htmlFor={`handover-note-${batch.id}`}>
                      <TextInput
                        id={`handover-note-${batch.id}`}
                        value={notesByBatch[batch.id] ?? ''}
                        onChange={(event) => setNotesByBatch((current) => ({ ...current, [batch.id]: event.target.value }))}
                        placeholder="Required when rejecting"
                      />
                    </Field>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="danger" onClick={() => void signOff(batch, 'Rejected')} disabled={busyId === batch.id} icon={<XCircle size={16} />}>Reject handover</Button>
                    <Button size="sm" onClick={() => void signOff(batch, 'Accepted')} disabled={busyId === batch.id} icon={<SealCheck size={16} />}>Accept handover</Button>
                  </div>
                </div>
              )}
              {(batch.status === 'Accepted' || batch.status === 'Rejected') && (
                <p className="muted text-xs">{batch.status} by {batch.signedOffBy}. {batch.decisionNotes}</p>
              )}
              {(batch.status === 'Delivered' || batch.status === 'Accepted' || batch.status === 'Rejected') && (
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" icon={<DownloadSimple size={16} />} onClick={() => void downloadPackage(batch)} disabled={busyId === batch.id}>
                    {busyId === batch.id ? 'Preparing ZIP…' : 'Download ZIP package'}
                  </Button>
                </div>
              )}
            </Card>
          ))
        )}
      </div>
    </section>
  );
}
