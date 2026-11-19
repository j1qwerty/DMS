import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowSquareOut,
  ArrowsLeftRight,
  Barcode,
  Check,
  Copy,
  Eye,
  MapPinPlus,
  MapTrifold,
  Sparkle,
  Stack,
  UploadSimple,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { RowMenu, menuItemClass } from './RowMenu';
import { useSession } from '../../hooks/useService';
import { useFeatures } from '../../lib/features';
import type { RecordFile } from '../../types';
import type { FileActionKind } from './FileActionModals';

interface Props {
  file: RecordFile;
  onAction: (kind: FileActionKind, file: RecordFile) => void;
  /** `icons` for the dense table row; `labeled` for phone cards with full-size targets. */
  variant: 'icons' | 'labeled';
}

function Segment({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center overflow-hidden rounded-lg border border-base bg-[var(--rr-surface)]"
    >
      <span className="muted border-r border-base bg-[var(--rr-bg)] px-2 text-xs font-semibold leading-9">
        {label}
      </span>
      {children}
    </div>
  );
}

function IconAction({
  icon: IconCmp,
  label,
  onClick,
  to,
}: {
  icon: Icon;
  label: string;
  onClick?: () => void;
  /** Navigates instead of opening a dialog, so it can be opened in a new tab. */
  to?: string;
}) {
  const className =
    'focus-ring grid size-9 place-items-center transition hover:bg-[var(--rr-surface-2)] [&:not(:last-child)]:border-r [&:not(:last-child)]:border-[var(--rr-border)]';
  return to ? (
    <Link to={to} title={label} aria-label={label} className={className}>
      <IconCmp size={17} />
    </Link>
  ) : (
    <button type="button" onClick={onClick} title={label} aria-label={label} className={className}>
      <IconCmp size={17} />
    </button>
  );
}

function LabeledAction({
  icon: IconCmp,
  label,
  onClick,
  to,
}: {
  icon: Icon;
  label: string;
  onClick?: () => void;
  to?: string;
}) {
  const className =
    'focus-ring flex min-h-11 items-center justify-center gap-2 rounded-lg border border-base bg-[var(--rr-surface)] px-3 text-[13px] font-semibold active:bg-[var(--rr-surface-2)]';
  const inner = (
    <>
      <IconCmp size={18} className="text-accent" />
      {label}
    </>
  );
  return to ? (
    <Link to={to} className={className}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  );
}

function MoreMenu({ file, trigger }: { file: RecordFile; trigger?: boolean }) {
  const { allowed } = useSession();
  const { barcode } = useFeatures();
  const [copied, setCopied] = useState(false);

  const copy = async (close: () => void) => {
    try {
      await navigator.clipboard.writeText(file.fileBarcode);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
        close();
      }, 900);
    } catch {
      close();
    }
  };

  return (
    <RowMenu
      label={`More actions for ${file.fileNumber}`}
      trigger={
        trigger ? (
          <>
            <ArrowSquareOut size={18} className="text-accent" /> More
          </>
        ) : undefined
      }
      className={trigger ? 'w-full' : undefined}
    >
      {(close) => (
        <>
          <Link to={`/files/${file.id}`} role="menuitem" onClick={close} className={menuItemClass}>
            <ArrowSquareOut size={18} className="muted" /> Open full details
          </Link>
          {barcode && (
            <button
              role="menuitem"
              type="button"
              onClick={() => void copy(close)}
              className={menuItemClass}
            >
              {copied ? (
                <Check size={18} className="text-[var(--rr-success)]" />
              ) : (
                <Copy size={18} className="muted" />
              )}
              {copied ? 'Barcode copied' : 'Copy barcode'}
            </button>
          )}
          {file.roomId && (
            <Link
              to={`/rooms/${file.roomId}`}
              role="menuitem"
              onClick={close}
              className={menuItemClass}
            >
              <Stack size={18} className="muted" /> Show its room
            </Link>
          )}
          {barcode && allowed('barcodes.print') && (
            <Link to="/barcodes" role="menuitem" onClick={close} className={menuItemClass}>
              <Barcode size={18} className="muted" /> Print barcode label
            </Link>
          )}
        </>
      )}
    </RowMenu>
  );
}

/**
 * The action set for one file: view / upload its scan, edit it in the studio
 * (round 4 — parse, reorder, replace pages, build the deliverable PDF), view /
 * upload its map, move it, and an overflow menu. Buttons the signed-in role
 * cannot use are hidden rather than disabled, so a reader is not shown things
 * they cannot do.
 */
export function FileRowActions({ file, onAction, variant }: Props) {
  const { allowed } = useSession();
  const canEdit = allowed('files.edit');
  const canUploadMap = canEdit || allowed('digitization.upload');
  const canStudio = allowed('studio.use');
  const scanPath = `/files/${file.id}/scan`;
  const mapPath = `/files/${file.id}/map`;
  const studioPath = `/files/${file.id}/studio`;

  if (variant === 'labeled') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <LabeledAction icon={Eye} label="View file" to={scanPath} />
        {canStudio && <LabeledAction icon={Sparkle} label="Edit in studio" to={studioPath} />}
        {canEdit && (
          <LabeledAction
            icon={UploadSimple}
            label="Upload file"
            onClick={() => onAction('upload', file)}
          />
        )}
        <LabeledAction icon={MapTrifold} label="View map" to={mapPath} />
        {canUploadMap && (
          <LabeledAction
            icon={MapPinPlus}
            label="Upload map"
            onClick={() => onAction('mapUpload', file)}
          />
        )}
        {canEdit && (
          <LabeledAction
            icon={ArrowsLeftRight}
            label="Move"
            onClick={() => onAction('move', file)}
          />
        )}
        <MoreMenu file={file} trigger />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Segment label="File">
        <IconAction icon={Eye} label="View file scan" to={scanPath} />
        {canStudio && <IconAction icon={Sparkle} label="Edit in scan studio" to={studioPath} />}
        {canEdit && (
          <IconAction
            icon={UploadSimple}
            label="Upload file scan"
            onClick={() => onAction('upload', file)}
          />
        )}
      </Segment>
      <Segment label="Map">
        <IconAction icon={MapTrifold} label="View map" to={mapPath} />
        {canUploadMap && (
          <IconAction
            icon={MapPinPlus}
            label="Upload map"
            onClick={() => onAction('mapUpload', file)}
          />
        )}
      </Segment>
      {canEdit && (
        <button
          type="button"
          onClick={() => onAction('move', file)}
          className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg border border-base bg-[var(--rr-surface)] px-2.5 text-[13px] font-semibold hover:bg-[var(--rr-surface-2)]"
        >
          <ArrowsLeftRight size={16} className="text-accent" /> Move
        </button>
      )}
      <MoreMenu file={file} />
    </div>
  );
}
