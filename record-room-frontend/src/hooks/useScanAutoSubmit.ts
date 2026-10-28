import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

/**
 * Gun-scanner auto-submit (work plan §2.1 D2).
 *
 * A barcode gun "types" like a fast keyboard and may or may not send a
 * trailing Enter. Until now every scan path depended on that Enter reaching a
 * form's implicit submit. This hook detects a fast keystroke burst inside the
 * scan input, waits for it to settle, and commits it without needing the
 * Enter — and it keeps the input focused so the next scan lands where the
 * operator expects.
 *
 * Human typing is deliberately ignored: a real typist leaves gaps far above
 * `BURST_WINDOW_MS`, so only gun-style input auto-submits. Manual entry and
 * pasted payloads still submit with Enter or the form button.
 */
const BURST_WINDOW_MS = 90;
const SETTLE_MS = 110;
/** Scans are complete codes — a shorter burst is not worth committing. */
const MIN_LENGTH = 4;
/** The gun's Enter and the burst submit can land close together; keep one. */
const DUPLICATE_WINDOW_MS = 500;

export function useScanAutoSubmit(
  value: string,
  submit: (value: string) => void,
  inputRef?: RefObject<HTMLInputElement | null>,
): (event: KeyboardEvent<HTMLInputElement>) => void {
  const submitRef = useRef(submit);
  const lastTypedAt = useRef(0);
  const burstStartedAt = useRef(0);
  const lastFired = useRef({ value: '', at: 0 });

  // Always-current submit callback without re-arming the burst effect.
  useEffect(() => {
    submitRef.current = submit;
  });

  useEffect(() => {
    const raw = value;
    if (!raw) return;
    const now = Date.now();
    if (now - lastTypedAt.current > BURST_WINDOW_MS) burstStartedAt.current = now;
    lastTypedAt.current = now;

    // Cleared on the next keystroke; only the burst's last character lets it run.
    const timer = window.setTimeout(() => {
      const candidate = raw.trim();
      if (candidate.length < MIN_LENGTH) return;
      if (lastTypedAt.current - burstStartedAt.current > BURST_WINDOW_MS) return;
      const fired = lastFired.current;
      if (fired.value === candidate && Date.now() - fired.at < DUPLICATE_WINDOW_MS) return;
      lastFired.current = { value: candidate, at: Date.now() };
      submitRef.current(candidate);
      inputRef?.current?.focus();
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
    // Re-arms only on a keystroke: every other dependency lives in a ref.
  }, [value, inputRef]);

  // Enter keeps working even where the implicit form submit does not reach
  // (e.g. the input lives outside the <form>), and dedupes against the burst.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const candidate = event.currentTarget.value.trim();
    if (!candidate) return;
    const fired = lastFired.current;
    if (fired.value === candidate && Date.now() - fired.at < DUPLICATE_WINDOW_MS) return;
    lastFired.current = { value: candidate, at: Date.now() };
    submitRef.current(candidate);
    inputRef?.current?.focus();
  };

  return onKeyDown;
}
