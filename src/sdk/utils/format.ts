/**
 * Format a token amount from smallest units to human-readable form.
 * @param amount Amount in smallest units (as string)
 * @param decimals Number of decimal places
 */
export function formatAmount(amount: string, decimals: number): string {
  if (!amount || amount === '0') return '0';

  const isNegative = amount.startsWith('-');
  const abs = isNegative ? amount.slice(1) : amount;

  if (decimals === 0) return (isNegative ? '-' : '') + abs;

  const padded = abs.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals);
  const decPart = padded.slice(padded.length - decimals);

  // Trim trailing zeros
  const trimmed = decPart.replace(/0+$/, '');
  const prefix = isNegative ? '-' : '';

  return trimmed ? `${prefix}${intPart}.${trimmed}` : `${prefix}${intPart}`;
}
