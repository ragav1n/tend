import { MARK_BAR, MARK_SIZE, MARK_STEM, TILE_RADIUS_RATIO } from '@/lib/brand';
import { cn } from '@/lib/utils';

/**
 * The bare mark. Filled with currentColor so it inherits like a glyph and can
 * sit inside a line of text without a colour prop.
 */
export function Mark({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`}
      fill="currentColor"
      aria-hidden
      focusable="false"
      className={className}
      style={style}
    >
      <path d={MARK_STEM} />
      <path d={MARK_BAR} />
    </svg>
  );
}

/**
 * The mark on its clay tile, which is what the app icon, the favicon and the
 * email header all show. Carrying --shadow-flush and the top hairline keeps it
 * on the same material as every other raised thing in the app instead of
 * looking like a sticker dropped on the surface.
 *
 * The radius scales with the tile so one component covers 26px in the rail and
 * 48px on the sign-in screen.
 */
export function MarkTile({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center bg-clay-600 text-on-accent',
        'border border-line-bright',
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: size * TILE_RADIUS_RATIO,
        boxShadow: 'var(--shadow-flush)',
      }}
    >
      <Mark style={{ width: size * 0.62, height: size * 0.62 }} />
    </span>
  );
}
