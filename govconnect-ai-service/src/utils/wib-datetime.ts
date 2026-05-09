/**
 * Village timezone date-time utility.
 *
 * Safe across any server timezone and defaults to Asia/Jakarta.
 */

export const DEFAULT_VILLAGE_TIMEZONE = 'Asia/Jakarta';
export const SUPPORTED_VILLAGE_TIMEZONES = [
  'Asia/Jakarta',
  'Asia/Makassar',
  'Asia/Jayapura',
] as const;

export type SupportedVillageTimezone = typeof SUPPORTED_VILLAGE_TIMEZONES[number];

export interface VillageDateTime {
  date: string;
  tomorrow: string;
  time: string;
  timeOfDay: string;
  timezone: SupportedVillageTimezone;
  timezoneAbbreviation: 'WIB' | 'WITA' | 'WIT';
}

export function resolveVillageTimezone(timezone?: string | null): SupportedVillageTimezone {
  return SUPPORTED_VILLAGE_TIMEZONES.includes((timezone || '') as SupportedVillageTimezone)
    ? (timezone as SupportedVillageTimezone)
    : DEFAULT_VILLAGE_TIMEZONE;
}

export function getTimezoneAbbreviation(timezone?: string | null): 'WIB' | 'WITA' | 'WIT' {
  const resolved = resolveVillageTimezone(timezone);
  if (resolved === 'Asia/Makassar') return 'WITA';
  if (resolved === 'Asia/Jayapura') return 'WIT';
  return 'WIB';
}

export function getVillageDateTime(timezone?: string | null): VillageDateTime {
  const resolved = resolveVillageTimezone(timezone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolved,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());

  const getPart = (type: string) => parts.find((part) => part.type === type)?.value || '';
  const hour = Number(getPart('hour'));

  let timeOfDay = 'malam';
  if (hour >= 5 && hour < 11) timeOfDay = 'pagi';
  else if (hour >= 11 && hour < 15) timeOfDay = 'siang';
  else if (hour >= 15 && hour < 18) timeOfDay = 'sore';

  const date = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
  const tomorrowBase = new Date(Date.UTC(Number(getPart('year')), Number(getPart('month')) - 1, Number(getPart('day')) + 1));
  const tomorrow = tomorrowBase.toISOString().split('T')[0];

  return {
    date,
    tomorrow,
    time: `${getPart('hour')}:${getPart('minute')}`,
    timeOfDay,
    timezone: resolved,
    timezoneAbbreviation: getTimezoneAbbreviation(resolved),
  };
}

export function formatVillageDateTimeForPrompt(timezone?: string | null): string {
  const ctx = getVillageDateTime(timezone);
  return `${ctx.date} ${ctx.time} ${ctx.timezoneAbbreviation}`;
}

export const getWIBDateTime = () => getVillageDateTime('Asia/Jakarta');
