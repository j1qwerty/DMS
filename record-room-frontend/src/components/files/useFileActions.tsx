import { useCallback, useState, type ReactNode } from 'react';
import {
  MoveFileModal,
  UploadFileModal,
  UploadMapModal,
  type ActionContext,
  type FileActionKind,
} from './FileActionModals';
import type { RecordFile } from '../../types';

/**
 * One place that owns the "act on a file" dialogs, so the files table, the
 * dashboard and any future list share the same view / upload / move / map flows.
 */
export function useFileActions(onChanged: (message: string) => void): {
  open: (kind: FileActionKind, file: RecordFile) => void;
  dialogs: ReactNode;
} {
  const [active, setActive] = useState<{ kind: FileActionKind; file: RecordFile } | null>(null);

  const open = useCallback(
    (kind: FileActionKind, file: RecordFile) => setActive({ kind, file }),
    [],
  );

  let dialogs: ReactNode = null;
  if (active) {
    const context: ActionContext = {
      file: active.file,
      onClose: () => setActive(null),
      onDone: (message) => {
        setActive(null);
        onChanged(message);
      },
    };
    const Dialog = {
      upload: UploadFileModal,
      move: MoveFileModal,
      mapUpload: UploadMapModal,
    }[active.kind];
    // Keyed so switching between dialogs resets each one's local state.
    dialogs = <Dialog key={active.kind} {...context} />;
  }

  return { open, dialogs };
}
