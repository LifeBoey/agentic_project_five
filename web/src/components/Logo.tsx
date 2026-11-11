/** The project mark: a drone seen from above. Three rotors are ordinary, the red one depends on a single
 *  country, and the faint ring around it is the deeper tier behind it. Decorative: the h1 beside it carries the name.
 *  Keep the geometry in sync with public/logo.svg, which is the standalone copy used as the favicon and in the README. */
export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg className="logo-mark" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      <g className="logo-ink" strokeWidth="3.5" strokeLinecap="round">
        <line x1="32" y1="32" x2="20.7" y2="20.7" />
        <line x1="32" y1="32" x2="43.3" y2="20.7" />
        <line x1="32" y1="32" x2="20.7" y2="43.3" />
        <line x1="32" y1="32" x2="43.3" y2="43.3" />
      </g>
      <g className="logo-ink" fill="none" strokeWidth="4">
        <circle cx="15" cy="15" r="8" />
        <circle cx="49" cy="15" r="8" />
        <circle cx="15" cy="49" r="8" />
      </g>
      <circle className="logo-tier" cx="49" cy="49" r="13" fill="none" strokeWidth="1.75" />
      <circle className="logo-risk" cx="49" cy="49" r="8" />
      <rect className="logo-body" x="26" y="26" width="12" height="12" rx="3" transform="rotate(45 32 32)" />
    </svg>
  );
}
