/**
 * scoup.ai horizontal logo lockup (brand/README.md), drawn inline from the exact geometry of
 * brand/lockup-horizontal.svg (test/brand.test.tsx keeps the two in sync).
 *
 * Inline SVG rather than <img>: no extra request, no <img> element that the "untrusted content never
 * becomes an <img>" safety checks would confuse with injected markup, and colours can follow the
 * theme. The presentation attributes are the light-surface (dark tile) colours; app.css switches to
 * the on-dark palette under [data-theme='dark']. No style attributes, so CSP `style-src 'self'` holds.
 *
 * The name is always lowercase "scoup.ai" and never placed in an uppercase (text-transform) context.
 */
export const BRAND_NAME = 'scoup.ai';
/** Horizontal lockup viewBox (brand/lockup-horizontal.svg). */
const VIEW_BOX = '0 -24.97 873.32 162.97';
const LOCKUP_RATIO = 873.32 / 162.97;
/** Minimum on-screen height of the horizontal lockup. */
export const BRAND_MIN_HEIGHT_PX = 20;

export function BrandLockup({ height, className }: { height: number; className?: string }) {
  const h = Math.max(height, BRAND_MIN_HEIGHT_PX);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={VIEW_BOX}
      width={Math.round(h * LOCKUP_RATIO)}
      height={h}
      role="img"
      aria-label={BRAND_NAME}
      focusable="false"
      className={`brand-lockup${className ? ` ${className}` : ''}`}
    >
      <g transform="translate(0 -20) scale(1.4)">
        <rect className="brand-tile" width="100" height="100" rx="22" fill="#0f172a" />
        <path className="brand-upper" d="M64.72 27.5A17 15 0 1 0 50 50" fill="none" stroke="#ffffff" strokeWidth="13" />
        <path className="brand-lower" d="M50 50A17 15 0 1 1 35.28 72.5" fill="none" stroke="#2dd4bf" strokeWidth="13" />
      </g>
      <g transform="translate(184 0)">
        <g className="brand-letters" fill="none" stroke="#0f172a" strokeWidth="15">
          <path d="M58.04 17.67A26.84 22 0 1 0 34.34 50A26.84 22 0 1 1 10.64 82.33" />
          <path d="M164.46 16.29A44 44 0 1 0 164.46 83.71" />
          <circle cx="233.78" cy="50" r="44" />
          <path d="M309.78 0V59A35 35 0 0 0 379.78 59M379.78 0V100" />
          <path d="M414.78 0V138" />
          <circle cx="458.78" cy="50" r="44" />
        </g>
        <g className="brand-ai-dots" fill="#64748b">
          <circle cx="533.54" cy="92.74" r="7.26" />
          <circle cx="682.06" cy="-17.71" r="7.26" />
        </g>
        <g className="brand-ai" fill="none" stroke="#64748b" strokeWidth="11">
          <circle cx="605.3" cy="50" r="46" />
          <path d="M651.3 0V100" />
          <path d="M682.06 0V100" />
        </g>
      </g>
    </svg>
  );
}
