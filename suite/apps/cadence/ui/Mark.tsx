/**
 * Three lanes, different lengths, offset starts — the timeline itself. Same
 * geometry as the favicon, so the tab and the header agree.
 */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Cadence"
      focusable="false"
    >
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <g fill="var(--grey-0)">
        <rect x="6" y="9" width="16" height="4" rx="2" />
        <rect x="11" y="15" width="15" height="4" rx="2" />
        <rect x="6" y="21" width="10" height="4" rx="2" />
      </g>
    </svg>
  );
}
