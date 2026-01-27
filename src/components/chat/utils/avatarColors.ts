/**
 * Color data for consistent user colors based on pubkey
 */
export interface UserColor {
  gradient: string;
  text: string;
}

const colors: UserColor[] = [
  { gradient: 'from-blue-500 to-blue-600', text: 'text-blue-500' },
  { gradient: 'from-purple-500 to-purple-600', text: 'text-purple-500' },
  { gradient: 'from-green-500 to-green-600', text: 'text-green-500' },
  { gradient: 'from-pink-500 to-pink-600', text: 'text-pink-500' },
  { gradient: 'from-indigo-500 to-indigo-600', text: 'text-indigo-500' },
  { gradient: 'from-teal-500 to-teal-600', text: 'text-teal-500' },
  { gradient: 'from-cyan-500 to-cyan-600', text: 'text-cyan-500' },
  { gradient: 'from-rose-500 to-rose-600', text: 'text-rose-500' },
];

/**
 * Get a consistent color based on pubkey hash
 */
export function getColorFromPubkey(pubkey: string): UserColor {
  let hash = 0;
  for (let i = 0; i < pubkey.length; i++) {
    hash = pubkey.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}
