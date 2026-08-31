/**
 * Three figures shoulder to shoulder: a crew, not a timeline. Same rounded
 * square and palette as Cadence's mark, so the family reads as a family.
 */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Brigade"
      focusable="false"
    >
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <g fill="var(--grey-0)">
        <circle cx="9" cy="12" r="3" />
        <circle cx="16" cy="10" r="3" />
        <circle cx="23" cy="12" r="3" />
        <path d="M4 25c0-3.3 2.2-5.5 5-5.5S14 21.7 14 25z" />
        <path d="M11 25c0-3.6 2.2-6 5-6s5 2.4 5 6z" />
        <path d="M18 25c0-3.3 2.2-5.5 5-5.5S28 21.7 28 25z" />
      </g>
    </svg>
  );
}
