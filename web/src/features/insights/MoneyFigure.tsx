import type { InsightsMoneyLabel } from '@fr/shared';

import { formatUsdCents } from '../../lib/format';

/**
 * The only component that renders a money amount on the insights page (REQ-20261018-exec-dashboard). The
 * label is one of INSIGHTS_MONEY_LABELS; the same word is visible in the figure's caption, cell or header.
 */
export function MoneyFigure({ cents, label }: { cents: number; label: InsightsMoneyLabel }) {
  return (
    <span data-money-label={label} className="num">
      {formatUsdCents(cents)}
    </span>
  );
}
