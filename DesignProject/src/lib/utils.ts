import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTimeToAmPm(time?: string | null) {
  if (!time) return '';
  // Expecting HH:MM (24-hour) from backend
  const parts = String(time).split(':');
  if (parts.length < 2) return time;
  let hh = parseInt(parts[0], 10);
  const mm = parts[1].padStart(2, '0');
  if (Number.isNaN(hh)) return time;
  const suffix = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${mm} ${suffix}`;
}
