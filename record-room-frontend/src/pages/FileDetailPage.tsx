import { useState, useEffect } from 'react';
import {
  Link,
  NavLink,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  ArrowLeft,
  ArrowsLeftRight,
  CheckCircle,
  ClockCounterClockwise,
  FileText,
  Info as InfoIcon,
  MapPin,
  MapPinPlus,
  MapTrifold,
  PencilSimple,
  Printer,
  Trash,
  UploadSimple,
  UserCircle,
} from '@phosphor-icons/react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Field, SelectInput, TextInput } from '../components/ui/Field';
import { StatusBadge } from '../components/ui/Flash';
import { BarcodeSymbol } from '../components/BarcodeSymbol';
import { ShelfView } from '../components/ShelfView';
import { DocumentViewer } from '../components/files/DocumentViewer';
import {
  MoveFileModal,
  UploadFileModal,
  UploadMapModal,
} from '../components/files/FileActionModals';
import { ScanStudioPage, type UnifiedDocumentVersion } from './ScanStudioPage';
import { useFlash, useQuery, useService, useSession } from '../hooks/useService';
import { useFeatures } from '../lib/features';
import { buildPayload } from '../lib/barcode';
import { pushRecentFile } from '../lib/recent';
import { describePageCount, formatDocumentSize } from '../lib/document';
import { cn } from '../lib/utils';
import type {
  DocumentDerivative,
  IssueRecord,
  MapUpload,
  MovementEvent,
  RecordFile,
  RecordFileDocument,
  Room,
} from '../types';
import type { Page } from '../services/contracts';

const EMPTY_ROOMS: Room[] = [];
const EMPTY_MOVEMENTS: MovementEvent[] = [];
const EMPTY_DOCS: RecordFileDocument[] = [];
const EMPTY_MAPS: MapUpload[] = [];
const EMPTY_ISSUE_PAGE: Page<IssueRecord> = { items: [], total: 0, page: 1, pageSize: 500 };

type Dialog = 'upload' | 'mapUpload' | 'move' | null;
type TabKey = 'scan' | 'details' | 'studio' | 'map';

export function FileDetailPage() {
  const { fileId = '' } = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const service = useService();
  const { allowed, user } = useSession();
  const { barcode } = useFeatures();
  const { success, danger } = useFlash();

  const tab: TabKey = pathname.endsWith('/studio')
    ? 'studio'
    : pathname.endsWith('/map')
      ? 'map'
      : pathname.endsWith('/details')
        ? 'details'
        : 'scan';

  const canEdit = allowed('files.edit');
  const canStudio = allowed('studio.use');
  const canUploadMap = canEdit || allowed('digitization.upload');
  const canDeleteScan = user?.role === 'Admin';

  const [dialog, setDialog] = useState<Dialog>(null);
  const [shelfId, setShelfId] = useState('');
  const [position, setPosition] = useState(1);
  const [reason, setReason] = useState('');
  const [eOfficeDraft, setEOfficeDraft] = useState<string | null>(null);
  const [savingEOffice, setSavingEOffice] = useState(false);

  const {
    data: file,
    loading: loadingFile,
    reload: reloadFile,
  } = useQuery(() => service.files.get(fileId), [fileId], null as RecordFile | null, ['files']);

  const { data: rooms } = useQuery(() => service.locations.listRooms(), [], EMPTY_ROOMS);

  const { data: docs, reload: reloadDocs } = useQuery(
    () => service.files.listDocuments(fileId),
    [fileId],
    EMPTY_DOCS,
  );

  const { data: deliverables, reload: reloadDeliverables } = useQuery(
    () => (fileId ? service.digitization.listPdfs(fileId) : Promise.resolve([])),
    [fileId],
    [] as DocumentDerivative[],
  );

  const fileBarcode = file?.fileBarcode ?? '';
  const { data: maps, reload: reloadMaps } = useQuery(
    async () =>
      fileBarcode
        ? [...(await service.uploads.maps({ fileBarcode }))].sort(
            (a, b) => a.pageNo - b.pageNo || b.version - a.version,
          )
        : EMPTY_MAPS,
    [fileBarcode],
    EMPTY_MAPS,
  );

  const { data: movements, reload: reloadMovements } = useQuery(
    () => service.movements.list({ fileId, limit: 50 }),
    [fileId],
    EMPTY_MOVEMENTS,
  );

  const { data: openIssues } = useQuery(
    () => service.issues.list({ open: true, pageSize: 500 }),
    [],
    EMPTY_ISSUE_PAGE,
  );

  useEffect(() => {
    if (!file) return;
    pushRecentFile({
      id: file.id,
      ref: barcode ? file.fileBarcode : file.fileNumber,
      subject: file.subject,
      status: file.status,
    });
  }, [file, barcode]);

  if (!file) {
    return (
      <EmptyState
        title={loadingFile ? 'Opening document…' : 'File not found'}
        description={
          loadingFile ? 'Loading registry record.' : 'That file is not in the registry any more.'
        }
        action={
          loadingFile ? undefined : (
            <Link to="/files" className="focus-ring text-sm font-semibold text-accent">
              Back to documents
            </Link>
          )
        }
      />
    );
  }

  const allVersions: UnifiedDocumentVersion[] = [
    ...docs.map((doc) => ({
      id: doc.id,
      source: 'document' as const,
      filename: doc.filename,
      versionLabel: `v${doc.version}`,
      updatedAt: doc.uploadedAt,
      pageCount: doc.pageCount,
      sizeBytes: doc.sizeBytes,
      status: 'Approved' as const,
      rawDoc: doc,
    })),
    ...deliverables.map((deriv) => ({
      id: deriv.id,
      source: 'derivative' as const,
      filename: deriv.filename,
      versionLabel: `Build ${deriv.id}`,
      updatedAt: deriv.createdAt,
      pageCount: deriv.pageCount,
      sizeBytes: deriv.sizeBytes,
      status: (deriv.status === 'Approved'
        ? 'Approved'
        : deriv.status === 'Rejected'
          ? 'Rejected'
          : 'Pending approval') as UnifiedDocumentVersion['status'],
      reviewNote: deriv.reviewNote,
      reviewedBy: deriv.reviewedBy,
      rawDeriv: deriv,
    })),
  ].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const picked = params.get('v');
  const selectedVersion = allVersions.find((v) => v.id === picked) ?? allVersions[0];
  const selectedMap =
    maps.find((row) => row.id === picked) ?? maps.find((row) => row.hasDocument) ?? maps[0];

  const pick = (id: string) => setParams({ v: id }, { replace: true });

  const doneAction = (msg: string) => {
    setDialog(null);
    success(msg);
    reloadFile();
    reloadDocs();
    reloadMaps();
    reloadDeliverables();
  };

  const removeDoc = async (doc: RecordFileDocument) => {
    if (!window.confirm(`Delete ${doc.filename} (version ${doc.version}) permanently?`)) return;
    const result = await service.files.deleteDocument(fileId, doc.id);
    if (result.ok) {
      success(`Deleted ${doc.filename} v${doc.version}.`);
      if (params.get('v') === doc.id) setParams({}, { replace: true });
      reloadFile();
      reloadDocs();
    } else {
      danger(result.error);
    }
  };

  const room = rooms.find((item) => item.id === file.roomId);
  const unit =
    room?.storageUnits.find((item) => item.id === file.almirahId) ?? room?.storageUnits[0];
  const section = room?.sections.find((item) => item.id === file.sectionId);
  const openIssue = openIssues.items.find((issue) =>
    issue.lines.some((line) => line.fileId === file.id),
  );

  const shelfOptions = rooms.flatMap((item) =>
    item.sections.flatMap((sec) =>
      item.storageUnits
        .filter((u) => u.sectionId === sec.id)
        .flatMap((u) =>
          u.shelves
            .filter((shelf) => shelf.status === 'Active')
            .map((shelf) => ({
              id: shelf.id,
              label: `${item.code} / ${sec.name} / ${u.code} / ${shelf.code}`,
            })),
        ),
    ),
  );

  const saveEOfficeReference = async () => {
    if (!file) return;
    setSavingEOffice(true);
    try {
      const result = await service.files.updateEOfficeReference(
        file.id,
        eOfficeDraft ?? file.eOfficeReference ?? '',
      );
      if (!result.ok) {
        danger(result.error);
        return;
      }
      setEOfficeDraft(result.value.eOfficeReference ?? '');
      success(
        result.value.eOfficeReference ? 'E-office reference saved.' : 'E-office reference cleared.',
      );
      reloadFile();
    } finally {
      setSavingEOffice(false);
    }
  };

  const relocate = async () => {
    const result = await service.files.relocate(file.id, shelfId, position, reason);
    if (!result.ok) {
      danger(result.error);
      return;
    }
    success(
      barcode
        ? `Relocated to ${result.value.location}. Identity ${result.value.fileBarcode} is unchanged.`
        : `Relocated to ${result.value.location}.`,
    );
    setShelfId('');
    setReason('');
    reloadFile();
    reloadMovements();
  };

  const tabLink = (
    to: string,
    label: string,
    count: number | undefined,
    IconCmp: typeof FileText,
    isActive: boolean,
  ) => (
    <NavLink
      to={to}
      end
      className={cn(
        'focus-ring -mb-px inline-flex min-h-11 items-center gap-2 rounded-t-lg border-b-2 px-4 text-sm font-semibold transition',
        isActive
          ? 'border-[var(--rr-accent)] text-accent'
          : 'muted border-transparent hover:text-[var(--rr-text)]',
      )}
    >
      <IconCmp size={17} /> {label}
      {count !== undefined && (
        <span className="rounded-full bg-[var(--rr-surface-2)] px-1.5 text-xs">{count}</span>
      )}
    </NavLink>
  );

  return (
    <div className="space-y-5">
      {/* Identity Bar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <Link
            to="/files"
            className="focus-ring muted inline-flex min-h-9 items-center gap-1.5 rounded-lg text-[13px] font-semibold hover:text-[var(--rr-text)]"
          >
            <ArrowLeft size={15} /> Documents
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="mono text-xl font-bold tracking-tight md:text-2xl">{file.fileNumber}</h1>
            <StatusBadge status={file.status} />
          </div>
          <p className="muted mt-1 max-w-3xl text-sm leading-5">{file.subject}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {barcode && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Printer size={16} />}
              onClick={() => window.print()}
            >
              Print label
            </Button>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDialog('move')}
              icon={<ArrowsLeftRight size={16} />}
            >
              Move
            </Button>
          )}
          <Link
            to="/issue"
            className="focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-base bg-[var(--rr-surface)] px-3 text-[13px] font-semibold hover:bg-[var(--rr-surface-2)]"
          >
            Issue / return
          </Link>
        </div>
      </div>

      {/* Unified Tab Row */}
      <div className="flex gap-1 overflow-x-auto border-b border-base">
        {tabLink(
          `/files/${file.id}/scan`,
          'Document Preview',
          docs.length + deliverables.length,
          FileText,
          tab === 'scan',
        )}
        {tabLink(`/files/${file.id}/details`, 'Details', undefined, InfoIcon, tab === 'details')}
        {canStudio &&
          tabLink(
            `/files/${file.id}/studio`,
            'Edit in studio',
            undefined,
            PencilSimple,
            tab === 'studio',
          )}
        {tabLink(`/files/${file.id}/map`, 'Map', maps.length, MapTrifold, tab === 'map')}
      </div>

      {/* TAB 1: Document Preview */}
      {tab === 'scan' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Main Viewer Area (Full Height & Page-size Responsive) */}
          <div className="min-w-0">
            {selectedVersion ? (
              <DocumentViewer
                fill
                docKey={selectedVersion.id}
                load={() =>
                  selectedVersion.source === 'document'
                    ? service.files.documentBlob(file.id, selectedVersion.id)
                    : service.digitization.pdfBlob(selectedVersion.id)
                }
                filename={selectedVersion.filename}
                contentType={
                  selectedVersion.source === 'document'
                    ? selectedVersion.rawDoc?.contentType
                    : 'application/pdf'
                }
                toolbar={
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold">{selectedVersion.filename}</p>
                      {selectedVersion.source === 'derivative' &&
                        selectedVersion.status !== 'Approved' && (
                          <Badge
                            tone={selectedVersion.status === 'Rejected' ? 'danger' : 'warning'}
                          >
                            {selectedVersion.status}
                          </Badge>
                        )}
                    </div>
                    <p className="muted text-xs">
                      {selectedVersion.versionLabel} ·{' '}
                      {selectedVersion.sizeBytes
                        ? formatDocumentSize(selectedVersion.sizeBytes)
                        : ''}
                      {selectedVersion.pageCount
                        ? ` · ${describePageCount(selectedVersion.pageCount)}`
                        : ''}
                    </p>
                  </div>
                }
              />
            ) : (
              <Card>
                <EmptyState
                  title="No scan uploaded yet"
                  description="Upload a full-PDF scan for this document, or open Edit in studio to scan pages and build a deliverable PDF."
                  action={
                    <div className="flex flex-wrap gap-2">
                      {canEdit && (
                        <Button
                          size="sm"
                          onClick={() => setDialog('upload')}
                          icon={<UploadSimple size={16} />}
                        >
                          Upload scan
                        </Button>
                      )}
                      {canStudio && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<PencilSimple size={16} />}
                          onClick={() => navigate(`/files/${file.id}/studio`)}
                        >
                          Edit in studio
                        </Button>
                      )}
                    </div>
                  }
                />
              </Card>
            )}
          </div>

          {/* Right Sidebar: Selectable Version History */}
          <div className="space-y-4">
            <Card>
              <div className="mb-3 flex items-center justify-between border-b border-base pb-3">
                <div>
                  <p className="text-sm font-semibold">Document versions</p>
                  <p className="muted text-xs">{allVersions.length} stored version(s)</p>
                </div>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setDialog('upload')}
                    icon={<UploadSimple size={15} />}
                  >
                    Upload scan
                  </Button>
                )}
              </div>

              {allVersions.length === 0 ? (
                <p className="muted py-4 text-center text-xs">No scan versions recorded yet.</p>
              ) : (
                <ul className="divide-y divide-[var(--rr-border)]">
                  {allVersions.map((version, index) => {
                    const isSelected = selectedVersion?.id === version.id;
                    const isCurrent = index === 0;

                    return (
                      <li
                        key={version.id}
                        className={cn(
                          'rounded-xl p-3 transition',
                          isSelected
                            ? 'border border-[var(--rr-accent)] bg-accent-soft/40'
                            : 'hover:bg-[var(--rr-surface-2)]',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => pick(version.id)}
                            className="min-w-0 flex-1 text-left focus:outline-none"
                          >
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-xs font-semibold">
                                {version.filename}
                              </span>
                              {isCurrent && <Badge tone="success">Current version</Badge>}
                              {version.source === 'derivative' && version.status !== 'Approved' && (
                                <Badge tone={version.status === 'Rejected' ? 'danger' : 'warning'}>
                                  {version.status}
                                </Badge>
                              )}
                            </div>
                            <p className="muted mt-1 text-[11px]">
                              {version.versionLabel} ·{' '}
                              {new Date(version.updatedAt).toLocaleString()}
                            </p>
                            <p className="muted text-[11px]">
                              {version.sizeBytes ? formatDocumentSize(version.sizeBytes) : ''}
                              {version.pageCount
                                ? ` · ${describePageCount(version.pageCount)}`
                                : ''}
                            </p>
                            {version.reviewNote && (
                              <p className="mt-1 text-[11px] text-[var(--rr-warning)]">
                                Note: {version.reviewNote}
                              </p>
                            )}
                          </button>
                          <div className="flex items-center gap-1">
                            {canStudio && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="!h-7 !px-2 text-[11px]"
                                onClick={() => navigate(`/files/${file.id}/studio`)}
                                title="Open this file in studio"
                              >
                                Edit in studio
                              </Button>
                            )}
                            {version.source === 'document' && version.rawDoc && canDeleteScan && (
                              <button
                                type="button"
                                onClick={() => void removeDoc(version.rawDoc!)}
                                className="focus-ring rounded p-1 text-[var(--rr-muted)] hover:text-[var(--rr-danger)]"
                                title="Delete this scan version"
                                aria-label="Delete this scan version"
                              >
                                <Trash size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: Details (Clean metadata & physical placement — NO redundant preview) */}
      {tab === 'details' && (
        <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
          <div className="space-y-5">
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-sm font-semibold text-accent">
                    {barcode ? file.fileBarcode : file.fileNumber}
                  </p>
                  <p className="muted mt-2 text-xs">
                    {barcode
                      ? 'Permanent identity · immutable for the file lifecycle'
                      : 'File number'}
                  </p>
                </div>
                <StatusBadge status={file.status} />
              </div>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <Info label="File number" value={file.fileNumber} />
                <Info label="Department" value={file.department} />
                <Info label="Type" value={file.fileType} />
                <Info label="Year" value={String(file.year)} />
                <Info label="Codal life" value={file.codalLife} />
                <Info label="Created" value={`${file.createdAt} by ${file.createdBy}`} />
                <Info
                  label="Area / pincode"
                  value={`${file.area || '—'} / ${file.pincode || '—'}`}
                />
                <Info
                  label="Property"
                  value={`${file.propertyNo || '—'} · ${file.propertyArea || '—'}`}
                />
                <Info label="Dealer" value={file.dealer || '—'} />
                <Info label="Last movement" value={file.lastMovement} />
              </div>
              {barcode && (
                <div className="mt-6 rounded-xl bg-[var(--rr-bg)] p-4 text-[var(--rr-text)]">
                  <BarcodeSymbol value={buildPayload('File', file.fileBarcode).value} height={56} />
                </div>
              )}
            </Card>

            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">E-office reference</p>
                  <p className="muted mt-1 text-xs">
                    {file.eOfficeReference?.trim()
                      ? 'This registry record is linked to an e-office file.'
                      : 'No e-office file name or ID has been recorded.'}
                  </p>
                </div>
                <Badge tone={file.eOfficeReference?.trim() ? 'success' : 'neutral'}>
                  {file.eOfficeReference?.trim() ? 'Linked' : 'Not linked'}
                </Badge>
              </div>
              {file.eOfficeReference?.trim() && (
                <p className="mt-3 break-all rounded-lg bg-[var(--rr-bg)] p-3 font-mono text-xs">
                  {file.eOfficeReference}
                </p>
              )}
              {allowed('files.edit') && (
                <div className="mt-4 space-y-3 border-t border-base pt-4">
                  <Field
                    label="E-office file name / ID"
                    htmlFor="eoffice-reference"
                    hint="Optional. Clear the field to remove the link."
                  >
                    <TextInput
                      id="eoffice-reference"
                      value={eOfficeDraft ?? file.eOfficeReference ?? ''}
                      onChange={(event) => setEOfficeDraft(event.target.value)}
                      placeholder="e.g. EOFFICE/REV/2026/00123"
                    />
                  </Field>
                  <div className="flex justify-end">
                    <Button onClick={() => void saveEOfficeReference()} disabled={savingEOffice}>
                      {savingEOffice ? 'Saving…' : 'Save e-office reference'}
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            <Card>
              <div className="flex items-center gap-2">
                <FileText className="text-accent" size={19} />
                <p className="text-sm font-semibold">Description</p>
              </div>
              <p className="muted mt-4 text-sm leading-7">
                {file.description || 'No description provided.'}
              </p>
            </Card>

            <Card padding={false} className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-base p-5">
                <ClockCounterClockwise className="text-accent" size={19} />
                <p className="text-sm font-semibold">Location and movement history</p>
              </div>
              {movements.length === 0 ? (
                <p className="muted p-5 text-xs">No recorded movement for this file yet.</p>
              ) : (
                <ol className="divide-y divide-[var(--rr-border)]">
                  {movements.map((event) => (
                    <li key={event.id} className="p-5">
                      <div className="flex items-center justify-between gap-3">
                        <Badge tone="info">{event.kind}</Badge>
                        <span className="muted text-[11px]">
                          {event.at} · {event.actor}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                        <div>
                          <p className="muted text-[10px] uppercase tracking-wider">From</p>
                          <p className="mt-0.5 font-semibold">{event.from}</p>
                        </div>
                        <div>
                          <p className="muted text-[10px] uppercase tracking-wider">To</p>
                          <p className="mt-0.5 font-semibold">{event.to}</p>
                        </div>
                      </div>
                      <p className="muted mt-2 text-[11px]">{event.detail}</p>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Exact physical location</p>
                  <p className="muted mt-1 text-xs">Room → section → almirah → shelf</p>
                </div>
                <MapPin className="text-accent" size={19} />
              </div>
              <div className="mt-4 rounded-xl bg-accent-soft p-4">
                <p className="text-sm font-semibold">{file.location || 'Not placed'}</p>
                {file.shelfId ? (
                  <>
                    <p className="muted mt-2 text-xs">
                      Approximate shelf position · {file.position}% along shelf
                    </p>
                    <div className="mt-3 h-3 overflow-hidden rounded-full bg-[var(--rr-surface)]">
                      <div
                        className="h-full rounded-full bg-[var(--rr-accent)]"
                        style={{ width: `${file.position}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <p className="muted mt-2 text-xs">
                    Not on a shelf yet — pick a shelf below to place it.
                  </p>
                )}
                {barcode && (
                  <p className="muted mt-3 font-mono text-[11px]">
                    shelf barcode {file.shelfBarcode || '—'}
                  </p>
                )}
              </div>
              <div className="mt-4 flex gap-2">
                {file.roomId ? (
                  <Link
                    to={`/rooms/${file.roomId}`}
                    className="focus-ring inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-base bg-[var(--rr-surface)] py-2 text-xs font-semibold hover:bg-[var(--rr-surface-2)]"
                  >
                    <MapPin size={16} /> Open room
                  </Link>
                ) : (
                  <p className="muted flex-1 text-xs">No room assigned yet.</p>
                )}
              </div>
              {section && (
                <p className="muted mt-4 border-t border-base pt-4 text-xs leading-6">
                  Section <span className="font-mono font-semibold">{section.name}</span> of room{' '}
                  {room?.code}.
                </p>
              )}
            </Card>

            {unit && (
              <Card>
                <ShelfView unit={unit} activeShelf={file.shelf} />
              </Card>
            )}

            <Card>
              <div className="flex items-center gap-2">
                <UserCircle className="text-accent" size={19} />
                <p className="text-sm font-semibold">Current custodian state</p>
              </div>
              <div className="mt-4 flex items-start gap-3 rounded-xl bg-[var(--rr-bg)] p-4">
                <CheckCircle
                  size={20}
                  className={file.holder ? 'text-[var(--rr-warning)]' : 'text-[var(--rr-success)]'}
                />
                <div>
                  <p className="text-sm font-semibold">{file.holder ?? 'In record room'}</p>
                  {openIssue ? (
                    <p className="muted mt-1 text-xs">
                      Receipt {openIssue.receiptNumber} · due {openIssue.dueAt} ·{' '}
                      {openIssue.purpose}
                    </p>
                  ) : (
                    <p className="muted mt-1 text-xs">
                      Custody changes only through the issue and return desks.
                    </p>
                  )}
                </div>
              </div>
            </Card>

            {allowed('files.edit') && (
              <Card>
                <p className="text-sm font-semibold">
                  {file.shelfId ? 'Relocate this file' : 'Place this file on a shelf'}
                </p>
                <div className="mt-4 space-y-4">
                  <Field label="New shelf" htmlFor="relocate-shelf" required>
                    <SelectInput
                      id="relocate-shelf"
                      value={shelfId}
                      onChange={(event) => setShelfId(event.target.value)}
                    >
                      <option value="">Select a shelf</option>
                      {shelfOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                  <Field label="Position on shelf (1–100)" htmlFor="relocate-position">
                    <TextInput
                      id="relocate-position"
                      type="number"
                      min={1}
                      max={100}
                      value={position}
                      onChange={(event) => setPosition(Number(event.target.value))}
                    />
                  </Field>
                  <Field label="Reason" htmlFor="relocate-reason">
                    <TextInput
                      id="relocate-reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Shelf mapping reconciled during physical audit"
                    />
                  </Field>
                  <Button className="w-full" onClick={relocate} disabled={!shelfId}>
                    {file.shelfId ? 'Relocate file' : 'Place file'}
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: Edit in studio */}
      {tab === 'studio' && (
        <div>
          <ScanStudioPage embedded />
        </div>
      )}

      {/* TAB 4: Map (Large format / A0 optimized) */}
      {tab === 'map' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Main Map Viewer */}
          <div className="min-w-0">
            {selectedMap?.hasDocument ? (
              <DocumentViewer
                fill
                docKey={selectedMap.id}
                load={() => service.uploads.mapBlob(selectedMap.id)}
                filename={selectedMap.filename}
                contentType={selectedMap.contentType}
                toolbar={
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold">{selectedMap.filename}</p>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        A0 Map
                      </span>
                    </div>
                    <p className="muted text-xs">
                      Page {selectedMap.pageNo} · Version {selectedMap.version} ·{' '}
                      {selectedMap.sizeKb} KB
                    </p>
                  </div>
                }
              />
            ) : (
              <Card>
                <EmptyState
                  title="No map document attached"
                  description="Register or upload an A0 map drawing or copy for this file."
                  action={
                    canUploadMap && (
                      <Button
                        size="sm"
                        onClick={() => setDialog('mapUpload')}
                        icon={<MapPinPlus size={16} />}
                      >
                        Upload map
                      </Button>
                    )
                  }
                />
              </Card>
            )}
          </div>

          {/* Right Sidebar: Map Versions */}
          <div className="space-y-4">
            <Card>
              <div className="mb-3 flex items-center justify-between border-b border-base pb-3">
                <div>
                  <p className="text-sm font-semibold">Map versions</p>
                  <p className="muted text-xs">{maps.length} map row(s)</p>
                </div>
                {canUploadMap && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setDialog('mapUpload')}
                    icon={<MapPinPlus size={15} />}
                  >
                    Upload map
                  </Button>
                )}
              </div>

              {maps.length === 0 ? (
                <p className="muted py-4 text-center text-xs">No maps registered for this file.</p>
              ) : (
                <ul className="divide-y divide-[var(--rr-border)]">
                  {maps.map((m) => {
                    const isSelected = selectedMap?.id === m.id;
                    return (
                      <li
                        key={m.id}
                        className={cn(
                          'rounded-xl p-3 transition',
                          isSelected
                            ? 'bg-accent-soft/40 border border-[var(--rr-accent)]'
                            : 'hover:bg-[var(--rr-surface-2)]',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => pick(m.id)}
                          className="w-full text-left focus:outline-none"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold">{m.filename}</span>
                            <StatusBadge status={m.status} />
                          </div>
                          <p className="muted mt-1 text-[11px]">
                            Page {m.pageNo} · v{m.version} · {m.sizeKb} KB
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* Dialog Modals */}
      {dialog === 'move' && (
        <MoveFileModal
          file={file}
          onClose={() => setDialog(null)}
          onDone={(msg) => doneAction(msg)}
        />
      )}
      {dialog === 'upload' && (
        <UploadFileModal
          file={file}
          onClose={() => setDialog(null)}
          onDone={(msg) => doneAction(msg)}
        />
      )}
      {dialog === 'mapUpload' && (
        <UploadMapModal
          file={file}
          onClose={() => setDialog(null)}
          onDone={(msg) => doneAction(msg)}
        />
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="muted text-[10px] uppercase tracking-[0.12em]">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}
