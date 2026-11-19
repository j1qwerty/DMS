import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigationType, useNavigate } from 'react-router-dom';

/**
 * Where a top-bar back press lands when there is no in-app history (deep link,
 * refresh, shared URL): the section the page belongs to. Root destinations —
 * the sidebar entries themselves — never show a back button.
 */
const PARENT_ROUTES: Array<[RegExp, string]> = [
  [/^\/files\/new\/?$/, '/files'],
  [/^\/files\/[^/]+(\/.*)?$/, '/files'],
  [/^\/rooms\/[^/]+\/?$/, '/rooms'],
  [/^\/admin\/.+$/, '/admin'],
];

function parentOf(pathname: string): string | null {
  for (const [pattern, to] of PARENT_ROUTES) {
    if (pattern.test(pathname)) return to;
  }
  return null;
}

/**
 * The top-bar back button (round 5). Pages no longer carry their own back
 * links; the shell does, once, and it behaves like a browser back when the
 * user arrived by clicking through the app (a PUSH was recorded) and like a
 * section up-arrow when they landed on a deep link with empty history.
 *
 * `POP` also fires on the first render (initial load), which keeps the depth
 * at 0 until the first real in-app navigation — exactly what a deep link
 * should look like.
 */
export function useBackTarget(): { back: boolean; goBack: () => void } {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const depth = useRef(0);

  useEffect(() => {
    if (navigationType === 'PUSH') depth.current += 1;
    else if (navigationType === 'POP') depth.current = Math.max(0, depth.current - 1);
  }, [navigationType, pathname]);

  const parent = parentOf(pathname);
  const goBack = useCallback(() => {
    if (depth.current > 0) navigate(-1);
    else if (parent) navigate(parent);
  }, [navigate, parent]);

  return { back: parent !== null, goBack };
}
