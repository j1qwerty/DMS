/**
 * Loading skeletons (E3). Every read goes through `useQuery`, and while a
 * first read resolves the page used to print a "Loading…" empty state — a
 * text spinner that made the layout jump once real rows landed. These two
 * shapes hold the space instead: bars for a real `<table>`, stacked card
 * rows for list surfaces.
 */

/** A header bar plus shimmering rows sized by relative column weights. */
export function TableSkeleton({
  rows = 8,
  columns = [1.6, 1.4, 3, 1.3, 0.8, 1.2],
}: {
  rows?: number;
  columns?: number[];
}) {
  return (
    <div aria-hidden className="rounded-2xl border border-base bg-[var(--rr-surface)]">
      <div className="flex gap-4 border-b border-base px-5 py-3.5">
        {columns.map((weight, index) => (
          <span
            key={index}
            className="h-2.5 animate-pulse rounded bg-[var(--rr-surface-2)]"
            style={{ flexGrow: weight, flexBasis: 0 }}
          />
        ))}
      </div>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div
          key={rowIndex}
          className="flex items-center gap-4 border-b border-base px-5 py-4 last:border-b-0"
        >
          {columns.map((weight, index) => (
            <span
              key={index}
              className="h-3.5 animate-pulse rounded bg-[var(--rr-surface-2)]"
              style={{ flexGrow: weight, flexBasis: 0, animationDelay: `${rowIndex * 70}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Stacked card rows: a title bar, a sub bar, and a trailing meta block. */
export function RowSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden className="space-y-3">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div
          key={rowIndex}
          className="flex items-center gap-4 rounded-2xl border border-base bg-[var(--rr-surface)] p-4"
        >
          <div className="min-w-0 flex-1 space-y-2.5">
            <span
              className="block h-3.5 w-2/5 animate-pulse rounded bg-[var(--rr-surface-2)]"
              style={{ animationDelay: `${rowIndex * 70}ms` }}
            />
            <span
              className="block h-3 w-1/4 animate-pulse rounded bg-[var(--rr-surface-2)]"
              style={{ animationDelay: `${rowIndex * 70 + 35}ms` }}
            />
          </div>
          <span
            className="h-9 w-28 shrink-0 animate-pulse rounded-xl bg-[var(--rr-surface-2)]"
            style={{ animationDelay: `${rowIndex * 70}ms` }}
          />
        </div>
      ))}
    </div>
  );
}
