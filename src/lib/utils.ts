import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Zero-pad a number to (at least) two digits, e.g. 5 → "05". */
export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
