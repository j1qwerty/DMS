import { useSyncExternalStore } from 'react';
import { Flash } from './Flash';
import { dismissToast, getToasts, subscribeToasts } from '../../lib/toastStore';

/**
 * One consistent toast location (E6).
 *
 * Every write path used to render its own inline `<Flash>` banner at the top of
 * its own page, so a confirmation appeared in a different place on every screen
 * and vanished when the page re-rendered. Now every flash goes into one global
 * stack, fixed to the viewport: same corner on every page, above dialogs, and
 * independent of re-renders. Messages are pushed from `lib/toastStore` —
 * `useFlash` in `hooks/useService` is the usual entry point.
 */

/** Renders every toast in one fixed stack — the single flash location. */
export function ToastHost() {
  const current = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  if (current.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 z-[70] space-y-2 sm:left-auto sm:w-96"
    >
      {current.map((toast) => (
        <Flash
          key={toast.id}
          tone={toast.tone}
          text={toast.text}
          onDismiss={() => dismissToast(toast.id)}
        />
      ))}
    </div>
  );
}
