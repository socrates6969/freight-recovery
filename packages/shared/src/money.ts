/** Money is integer cents everywhere. Formatting never uses floating-point arithmetic on cents. */
export function formatUsdCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError('formatUsdCents: cents must be a safe integer');
  const negative = cents < 0;
  const abs = BigInt(Math.abs(cents));
  const dollars = abs / 100n;
  const rem = abs % 100n;
  const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return `${negative ? '-' : ''}$${grouped}.${rem.toString().padStart(2, '0')}`;
}
