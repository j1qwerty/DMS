/**
 * Recent files and recent searches behind the command palette (E8).
 *
 * These live in localStorage rather than the service layer on purpose: they are
 * a per-browser convenience, not registry data, so they work identically under
 * the local in-memory adapter and the HTTP API and never touch the audit trail.
 */

export type RecentFile = { id: string; ref: string; subject: string; status: string };

const FILE_KEY = 'rr.recent-files';
const SEARCH_KEY = 'rr.recent-searches';
const LIMIT = 6;

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, items: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Private browsing or a full quota: recents are a nicety, never an error.
  }
}

/** Records a file visit, newest first, de-duplicated by id. */
export function pushRecentFile(file: RecentFile) {
  const next = [file, ...read<RecentFile>(FILE_KEY).filter((item) => item.id !== file.id)];
  write(FILE_KEY, next.slice(0, LIMIT));
}

export const getRecentFiles = () => read<RecentFile>(FILE_KEY);

/** Records a search term, newest first, de-duplicated case-insensitively. */
export function pushRecentSearch(term: string) {
  const value = term.trim();
  if (value.length < 2) return;
  const lower = value.toLowerCase();
  const next = [value, ...read<string>(SEARCH_KEY).filter((item) => item.toLowerCase() !== lower)];
  write(SEARCH_KEY, next.slice(0, LIMIT));
}

export const getRecentSearches = () => read<string>(SEARCH_KEY);
