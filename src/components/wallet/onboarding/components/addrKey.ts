/** Composite key that uniquely identifies an address (receive vs change can share same index) */
export function addrKey(index: number, isChange?: boolean): string {
  return isChange ? `${index}c` : `${index}`;
}

/** Parse composite key back to index and isChange */
export function parseAddrKey(key: string): { index: number; isChange: boolean } {
  if (key.endsWith('c')) {
    return { index: parseInt(key.slice(0, -1), 10), isChange: true };
  }
  return { index: parseInt(key, 10), isChange: false };
}
