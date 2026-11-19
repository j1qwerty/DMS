import { Warning, type Icon } from '@phosphor-icons/react';
import { Button } from './Button';
import { Modal } from './Modal';

/**
 * The one confirmation dialog for destructive actions. Replaces the
 * window.confirm calls scattered over the file detail and studio pages: same
 * question, but with the app's own styling, a focus trap and an explicit
 * danger button, so nothing destructive happens on a stray Enter.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  busy = false,
  danger = true,
  icon,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  danger?: boolean;
  icon?: Icon;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <span
          className={
            danger
              ? 'grid size-10 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--rr-danger)_12%,transparent)] text-[var(--rr-danger)]'
              : 'grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent'
          }
        >
          {(() => {
            const Glyph = icon;
            return Glyph ? <Glyph size={22} /> : <Warning size={22} weight="fill" />;
          })()}
        </span>
        <p className="muted text-sm leading-6">{description}</p>
      </div>
    </Modal>
  );
}
