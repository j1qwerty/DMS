import type { FlashTone } from '../components/ui/Flash';

/**
 * The global toast store (E6). A module singleton rather than React state:
 * any page or modal can push a message without prop-drilling a setter, and
 * `ToastHost` subscribes with `useSyncExternalStore`.
 */
export type Toast = { id: number; tone: FlashTone; text: string };

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

export function pushToast(tone: FlashTone, text: string) {
  const id = ++seq;
  toasts = [...toasts, { id, tone, text }];
  emit();
  window.setTimeout(() => dismissToast(id), 6000);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getToasts = () => toasts;
