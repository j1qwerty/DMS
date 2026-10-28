import { useState } from 'react';
import { Link, NavLink, useLocation, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowSquareOut,
  ArrowsLeftRight,
  FileText,
  MapPinPlus,
  MapTrifold,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Flash, StatusBadge } from '../components/ui/Flash';
import { DocumentViewer } from '../components/files/DocumentViewer';
import {
  MoveFileModal,
  UploadFileModal,
  UploadMapModal,
} from '../components/files/FileActionModals';
import { useFlash, useQuery, useService, useSession } from '../hooks/useService';
import { useFeatures } from '../lib/features';
import { describePageCount, formatDocumentSize } from '../lib/document';
import { cn } from '../lib/utils';
import type { MapUpload, RecordFile, RecordFileDocument } from '../types';

const EMPTY_DOCS: RecordFileDocument[] = [];
const EMPTY_MAPS: MapUpload[] = [];

type Dialog = 'upload' | 'mapUpload' | 'move' | null;

/**
 * Full-page viewer for a file's scan or its map.
 *
 * `/files/:id/scan` and `/files/:id/map` share one layout: a toolbar with the file
 * identity and tabs, the document filling the screen, and a side panel with the file's
 * details and every stored version. The version in view lives in `?v=` so a link to a
 * specific page or version can be shared.
 */
export function FileViewerPage() {
  const { fileId = '' } = useParams();
  const { pathname } = useLocation();
  const tab: 'scan' | 'map' = pathname.endsWith('/map') ? 'map' : 'scan';
  const [params, setParams] = useSearchParams();
  const service = useService();
  const { allowed, user } = useSession();
  const { flash, success, danger, clear } = useFlash();
  const features = useFeatures();
  const [dialog, setDialog] = useState<Dialog>(null);

  const canEdit = allowed('files.edit');
  const canUploadMap = canEdit || allowed('digitization.upload');
  // Removing a stored scan version is destructive; the API re-checks the role.
  const canDeleteScan = user?.role === 'Admin';

  const {
    data: file,
    loading: loadingFile,
    reload: reloadFile,
  } = useQuery(() => service.files.get(fileId), [fileId], null as RecordFile | null, ['files']);
  const { data: docs, reload: reloadDocs } = useQuery(
    () => service.files.listDocuments(fileId),
    [fileId],
    EMPTY_DOCS,
  );
  const barcode = file?.fileBarcode ?? '';
  const { data: maps, reload: reloadMaps } = useQuery(
    async () =>
      barcode
        ? [...(await service.uploads.maps({ fileBarcode: barcode }))].sort(
            (a, b) => a.pageNo - b.pageNo || b.version - a.version,
          )
        : EMPTY_MAPS,
    [barcode],
    EMPTY_MAPS,
  );

  if (!file) {
    return (
      <EmptyState
        title={loadingFile ? 'Opening file…' : 'File not found'}
        description={
          loadingFile ? 'Loading the record.' : 'That file is not in the registry any more.'
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

  const picked = params.get('v');
  const selectedDoc = docs.find((doc) => doc.id === picked) ?? docs[0];
  const selectedMap =
    maps.find((row) => row.id === picked) ?? maps.find((row) => row.hasDocument) ?? maps[0];

  const pick = (id: string) => setParams({ v: id }, { replace: true });

  const done = (message: string) => {
    setDialog(null);
    success(message);
    reloadFile();
    reloadDocs();
    reloadMaps();
  };

  const removeDoc = async (doc: RecordFileDocument) => {
    if (!window.confirm(`Delete ${doc.filename} (version ${doc.version}) permanently?`)) return;
    const result = await service.files.deleteDocument(fileId, doc.id);
    if (result.ok) {
      success(`Deleted ${doc.filename} v${doc.version}.`);
      // If the removed version was open, drop back to the newest remaining one.
      if (params.get('v') === doc.id) setParams({}, { replace: true });
      reloadFile();
      reloadDocs();
    } else {
      danger(result.error);
    }
  };

  const tabLink = (to: string, label: string, count: number, Icon: typeof FileText) => (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          'focus-ring -mb-px inline-flex min-h-11 items-center gap-2 rounded-t-lg border-b-2 px-4 text-sm font-semibold transition',
          isActive
            ? 'border-[var(--rr-accent)] text-accent'
            : 'muted border-transparent hover:text-[var(--rr-text)]',
        )
      }
    >
      <Icon size={17} /> {label}
      <span className="rounded-full bg-[var(--rr-surface-2)] px-1.5 text-xs">{count}</span>
    </NavLink>
  );

  const uploadButton =
    tab === 'scan'
      ? canEdit && (
          <Button size="sm" onClick={() => setDialog('upload')} icon={<UploadSimple size={16} />}>
            Upload scan
          </Button>
        )
      : canUploadMap && (
          <Button size="sm" onClick={() => setDialog('mapUpload')} icon={<MapPinPlus size={16} />}>
            Upload map
          </Button>
        );

  return (
    <div className="space-y-4">
      {/* Identity bar */}
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
            to={`/files/${file.id}`}
            className="focus-ring inline-flex min-h-9 items-center gap-2 rounded-lg border border-base bg-[var(--rr-surface)] px-3 text-[13px] font-semibold hover:bg-[var(--rr-surface-2)]"
          >
            <ArrowSquareOut size={16} /> Full details
          </Link>
        </div>
      </div>

      {flash && <Flash tone={flash.tone} text={flash.text} onDismiss={clear} />}

      {/* Scan / Map tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-base">
        {tabLink(`/files/${file.id}/scan`, 'File scan', docs.length, FileText)}
        {tabLink(`/files/${file.id}/map`, 'Map', maps.length, MapTrifold)}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Viewer */}
        <div className="min-w-0">
          {tab === 'scan' ? (
            selectedDoc ? (
              <DocumentViewer
                fill
                docKey={selectedDoc.id}
                load={() => service.files.documentBlob(file.id, selectedDoc.id)}
                filename={selectedDoc.filename}
                contentType={selectedDoc.contentType}
                toolbar={
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{selectedDoc.filename}</p>
                    <p className="muted text-xs">
                      Version {selectedDoc.version} · {formatDocumentSize(selectedDoc.sizeBytes)}
                      {describePageCount(selectedDoc.pageCount) &&
                        ` · ${describePageCount(selectedDoc.pageCount)}`}
                    </p>
                  </div>
                }
              />
            ) : (
              <Card className="py-12 text-center">
                <FileText size={36} className="muted mx-auto" />
                <p className="mt-3 text-base font-semibold">No scan uploaded yet</p>
                <p className="muted mx-auto mt-1.5 max-w-sm text-sm leading-6">
                  {canEdit
                    ? 'Upload the scanned PDF or image of this file and it will open here.'
                    : 'Ask an operator to upload the scan.'}
                </p>
                {canEdit && <div className="mt-5">{uploadButton}</div>}
              </Card>
            )
          ) : selectedMap?.hasDocument ? (
            <DocumentViewer
              fill
              docKey={selectedMap.id}
              load={() => service.uploads.mapBlob(selectedMap.id)}
              filename={selectedMap.filename}
              contentType={selectedMap.contentType}
              pageIndex={selectedMap.pageIndex}
              toolbar={
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{selectedMap.filename}</p>
                  <p className="muted text-xs">
                    Page {selectedMap.pageNo} · version {selectedMap.version} · {selectedMap.status}
                  </p>
                </div>
              }
            />
          ) : (
            <Card className="py-12 text-center">
              <MapTrifold size={36} className="muted mx-auto" />
              <p className="mt-3 text-base font-semibold">
                {selectedMap ? 'This map page has no scan yet' : 'No map uploaded yet'}
              </p>
              <p className="muted mx-auto mt-1.5 max-w-sm text-sm leading-6">
                {canUploadMap
                  ? 'Upload the scanned map and it will open here.'
                  : 'Ask an operator to upload the map.'}
              </p>
              {canUploadMap && <div className="mt-5">{uploadButton}</div>}
            </Card>
          )}
        </div>

        {/* Side panel */}
        <aside className="space-y-4">
          {uploadButton && (selectedDoc || selectedMap) && (
            <div className="flex">{uploadButton}</div>
          )}

          <Card padding={false}>
            <div className="border-b border-base px-4 py-3">
              <h2 className="text-sm font-bold">
                {tab === 'scan' ? 'Scan versions' : 'Map pages'}
              </h2>
            </div>
            {tab === 'scan' ? (
              docs.length === 0 ? (
                <p className="muted p-4 text-sm">Nothing uploaded.</p>
              ) : (
                <ul className="divide-y divide-[var(--rr-border)]">
                  {docs.map((doc) => (
                    <li key={doc.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => pick(doc.id)}
                        aria-current={doc.id === selectedDoc?.id}
                        className={cn(
                          'focus-ring flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left hover:bg-[var(--rr-bg)]',
                          doc.id === selectedDoc?.id && 'bg-accent-soft',
                        )}
                      >
                        <Badge tone={doc.id === selectedDoc?.id ? 'info' : 'neutral'}>
                          v{doc.version}
                        </Badge>
                        <span className="min-w-0 text-[13px]">
                          <span className="block truncate font-semibold">{doc.filename}</span>
                          <span className="muted block text-xs">
                            {doc.uploadedAt} · {doc.uploadedBy}
                          </span>
                        </span>
                      </button>
                      {canDeleteScan && (
                        <button
                          type="button"
                          onClick={() => void removeDoc(doc)}
                          aria-label={`Delete version ${doc.version} (${doc.filename})`}
                          title="Delete this version"
                          className="focus-ring m-1 grid size-8 shrink-0 place-items-center rounded-lg text-[var(--rr-danger)] hover:bg-[color-mix(in_srgb,var(--rr-danger)_12%,transparent)]"
                        >
                          <Trash size={16} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )
            ) : maps.length === 0 ? (
              <p className="muted p-4 text-sm">Nothing uploaded.</p>
            ) : (
              <ul className="divide-y divide-[var(--rr-border)]">
                {maps.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => pick(row.id)}
                      aria-current={row.id === selectedMap?.id}
                      className={cn(
                        'focus-ring flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[var(--rr-bg)]',
                        row.id === selectedMap?.id && 'bg-accent-soft',
                      )}
                    >
                      <Badge tone={row.id === selectedMap?.id ? 'info' : 'neutral'}>
                        p{row.pageNo} · v{row.version}
                      </Badge>
                      <span className="min-w-0 text-[13px]">
                        <span className="block truncate font-semibold">{row.filename}</span>
                        <span className="muted block text-xs">
                          {row.hasDocument ? row.status : 'No scan attached'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card padding={false}>
            <div className="border-b border-base px-4 py-3">
              <h2 className="text-sm font-bold">About this file</h2>
            </div>
            <dl className="space-y-3 p-4 text-[13px]">
              {[
                ...(features.barcode
                  ? ([['Barcode', file.fileBarcode, true]] as Array<[string, string, boolean]>)
                  : []),
                ['Department', `${file.department} · ${file.year}`, false],
                [
                  'Type',
                  `${file.fileType}${file.documentSize ? ` · ${file.documentSize}` : ''}`,
                  false,
                ],
                ['Shelved at', file.location || 'No location recorded', false],
                ...(file.status === 'Issued' && file.holder
                  ? ([['Held by', file.holder, false]] as Array<[string, string, boolean]>)
                  : []),
              ].map(([label, value, mono]) => (
                <div key={String(label)}>
                  <dt className="muted text-xs">{label}</dt>
                  <dd className={cn('mt-0.5 break-words', mono && 'mono text-xs')}>{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </aside>
      </div>

      {dialog === 'upload' && (
        <UploadFileModal file={file} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog === 'mapUpload' && (
        <UploadMapModal file={file} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog === 'move' && (
        <MoveFileModal file={file} onClose={() => setDialog(null)} onDone={done} />
      )}
    </div>
  );
}
