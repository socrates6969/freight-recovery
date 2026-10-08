import { displayText } from '@fr/shared';

/**
 * Renders untrusted text as a React text node inside <bdi> (bidi isolation) with bidi override/isolate
 * controls stripped. Never interprets markup; long strings wrap.
 */
export function SafeText({ value, className }: { value: string | null | undefined; className?: string }) {
  return <bdi className={`safe-text${className ? ` ${className}` : ''}`}>{displayText(value)}</bdi>;
}
