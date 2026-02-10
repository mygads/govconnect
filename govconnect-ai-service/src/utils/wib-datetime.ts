/**
 * WIB (Waktu Indonesia Barat / UTC+7) Date-Time Utility
 *
 * Single source of truth for all WIB time calculations used in prompt templates.
 */

export interface WIBDateTime {
  /** YYYY-MM-DD */
  date: string;
  /** YYYY-MM-DD (tomorrow) */
  tomorrow: string;
  /** HH:MM */
  time: string;
  /** pagi | siang | sore | malam */
  timeOfDay: string;
}

/**
 * Get current date/time in WIB timezone.
 * Safe across any server timezone.
 */
export function getWIBDateTime(): WIBDateTime {
  const now = new Date();
  const wibOffsetMs = 7 * 60 * 60_000; // UTC+7
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const wibTime = new Date(utcMs + wibOffsetMs);

  const date = wibTime.toISOString().split('T')[0];

  const tom = new Date(wibTime);
  tom.setDate(tom.getDate() + 1);
  const tomorrow = tom.toISOString().split('T')[0];

  const time = wibTime.toTimeString().split(' ')[0].substring(0, 5); // HH:MM

  const hour = wibTime.getHours();
  let timeOfDay = 'malam';
  if (hour >= 5 && hour < 11) timeOfDay = 'pagi';
  else if (hour >= 11 && hour < 15) timeOfDay = 'siang';
  else if (hour >= 15 && hour < 18) timeOfDay = 'sore';

  return { date, tomorrow, time, timeOfDay };
}
