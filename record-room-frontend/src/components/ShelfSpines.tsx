import { cn } from '../lib/utils';

/**
 * Occupancy tier → spine colour. A full shelf reads as red because "no space
 * left" is the one state an operator needs to notice before filing.
 */
function spineTier(fill: number): 0 | 1 | 2 | 3 | 4 {
  if (fill >= 0.95) return 4;
  if (fill >= 0.7) return 3;
  if (fill >= 0.4) return 2;
  if (fill > 0) return 1;
  return 0;
}

export function Spine({
  fill,
  className,
  title,
}: {
  /** 0–1 share of capacity in use. Drives both height and colour. */
  fill: number;
  className?: string;
  title?: string;
}) {
  const tier = spineTier(fill);
  return (
    <span
      title={title}
      className={cn('block w-full rounded-[3px]', className)}
      style={{
        height: `${Math.max(18, Math.round(fill * 100))}%`,
        background: `var(--rr-spine-${tier})`,
      }}
    />
  );
}

/** Fixed, hand-set pattern for the login panel: a shelf of file spines, not data. */
const LOGIN_PATTERN = [
  0.62, 0.9, 0.48, 0.78, 0.35, 0.95, 0.7, 0.55, 0.85, 0.42, 0.74, 0.6, 0.92, 0.5, 0.8, 0.38, 0.68,
  0.88, 0.56, 0.76, 0.45, 0.97, 0.64, 0.82,
];

export function DecorativeSpines({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('flex h-40 items-end gap-1.5 border-b-4 border-[var(--rr-border)]', className)}
    >
      {LOGIN_PATTERN.map((fill, index) => (
        <span
          key={index}
          className="flex-1 rounded-t-[3px]"
          style={{
            height: `${fill * 100}%`,
            background:
              index % 7 === 3
                ? '#e0c97e'
                : index % 3 === 0
                  ? 'var(--rr-spine-3)'
                  : 'var(--rr-spine-1)',
          }}
        />
      ))}
    </div>
  );
}
