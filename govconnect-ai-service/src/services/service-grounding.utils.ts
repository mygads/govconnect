import type { ServiceCatalogItem } from './case-client.service';

export const COST_SIGNAL_REGEX = /\b(gratis|tanpa biaya|rp\.?\s*\d|rupiah|biaya(?:nya)?|tarif(?:nya)?|harga(?:nya)?)\b/i;
export const DURATION_SIGNAL_REGEX = /\b(estimasi|proses(?:nya)?|hari kerja|\d+\s*(hari|minggu|bulan|jam))\b/i;
export const REQUIREMENT_SIGNAL_REGEX = /\b(syarat|persyaratan|berkas|dokumen)\b/i;
export const NO_REQUIREMENT_REGEX = /\b(tidak ada|tanpa)\s+(syarat|persyaratan|berkas|dokumen)\b|\bcukup datang saja\b/i;
export const REQUIREMENT_DOC_SIGNAL_REGEX = /\b(ktp|kk|akta|akte|pas foto|foto|surat pengantar|formulir|npwp|bpjs|sertifikat|rekening|buku nikah)\b/i;
export const SERVICE_ONLINE_POSITIVE_REGEX = /\b(bisa online|diajukan online|diproses online|via online|lewat formulir|link formulir|isi formulir|ajukan lewat form|via form)\b/i;
export const SERVICE_ONLINE_NEGATIVE_REGEX = /\b(tidak bisa online|belum bisa online|hanya offline|offline saja|harus ke kantor|harus datang ke kantor|diproses langsung di kantor|tidak ada link formulir)\b/i;
export const SERVICE_AVAILABLE_POSITIVE_REGEX = /\b(tersedia|masih tersedia|aktif|bisa diajukan|bisa diurus|bisa diproses|bisa dilayani)\b/i;
export const SERVICE_AVAILABLE_NEGATIVE_REGEX = /\b(belum tersedia|tidak tersedia|sedang tidak tersedia|nonaktif|tidak aktif|belum bisa diajukan|tidak bisa diajukan|tidak bisa diproses)\b/i;

const DEFAULT_STOPWORDS = new Set(['alamat', 'lokasi', 'berada', 'terletak', 'di', 'desa', 'kantor']);

export function normalizeLooseText(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(tanpa biaya)\b/g, 'gratis')
    .replace(/\bsekitar\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function significantTokens(raw: string, stopwords: Set<string> = DEFAULT_STOPWORDS): string[] {
  return normalizeLooseText(raw)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stopwords.has(token));
}

export function findUniqueServiceMention(
  services: ServiceCatalogItem[],
  texts: string[],
  options: { requireExplicitMention?: boolean } = {},
): ServiceCatalogItem | null {
  const haystack = normalizeLooseText(texts.filter(Boolean).join(' '));
  if (!haystack) return null;

  const matches = services.filter((service) => {
    const normalizedName = normalizeLooseText(service.name || '');
    if (!normalizedName || normalizedName.length < 4) return false;
    if (haystack.includes(normalizedName)) return true;

    const nameTokens = significantTokens(service.name || '', new Set());
    const matchedTokens = nameTokens.filter((token) => haystack.includes(token));
    return matchedTokens.length >= Math.min(2, nameTokens.length);
  });

  if (matches.length === 1) return matches[0];
  if (options.requireExplicitMention) return null;
  return services.length === 1 ? services[0] : null;
}

export function responseMatchesDbValue(responseText: string, dbValue: string): boolean {
  const normalizedResponse = normalizeLooseText(responseText);
  const normalizedDbValue = normalizeLooseText(dbValue);
  if (!normalizedDbValue) return true;
  return normalizedResponse.includes(normalizedDbValue);
}

function normalizeDigits(raw: string): string {
  return (raw || '').replace(/[^\d]/g, '');
}

export function responseMatchesServiceCost(responseText: string, dbValue: string): boolean {
  const normalizedDbValue = normalizeLooseText(dbValue);
  if (!normalizedDbValue) return true;

  const mentionsGratis = /\b(gratis|tanpa biaya)\b/i.test(responseText);
  const mentionedAmounts = Array.from(responseText.matchAll(/\b(?:rp\.?|rupiah)\s*([\d.]+)/gi))
    .map((match) => normalizeDigits(match[1] || ''))
    .filter(Boolean);

  if (normalizedDbValue.includes('gratis')) {
    return mentionsGratis && mentionedAmounts.length === 0;
  }

  const dbDigits = normalizeDigits(dbValue);
  if (dbDigits) {
    return mentionedAmounts.includes(dbDigits);
  }

  return responseMatchesDbValue(responseText, dbValue);
}

export function responseMatchesServiceDuration(responseText: string, dbValue: string): boolean {
  const normalizedDbValue = normalizeLooseText(dbValue);
  if (!normalizedDbValue) return true;

  const normalizedResponse = normalizeLooseText(responseText);
  if (normalizedResponse.includes(normalizedDbValue)) return true;

  const dbDurationTokens = dbValue.match(/\d+(?:\s*-\s*\d+)?\s*(?:hari|minggu|bulan|jam)(?:\s+kerja)?/gi) || [];
  if (dbDurationTokens.length === 0) return false;

  const responseDurationTokens = responseText.match(/\d+(?:\s*-\s*\d+)?\s*(?:hari|minggu|bulan|jam)(?:\s+kerja)?/gi) || [];
  const normalizedResponseDurations = new Set(responseDurationTokens.map((item) => normalizeLooseText(item)));

  return dbDurationTokens
    .map((item) => normalizeLooseText(item))
    .some((item) => normalizedResponseDurations.has(item));
}

export function responseClaimsOnlineAvailability(responseText: string): boolean {
  return SERVICE_ONLINE_POSITIVE_REGEX.test(responseText);
}

export function responseClaimsOfflineOnly(responseText: string): boolean {
  return SERVICE_ONLINE_NEGATIVE_REGEX.test(responseText);
}

export function responseClaimsServiceAvailable(responseText: string): boolean {
  return SERVICE_AVAILABLE_POSITIVE_REGEX.test(responseText);
}

export function responseClaimsServiceUnavailable(responseText: string): boolean {
  return SERVICE_AVAILABLE_NEGATIVE_REGEX.test(responseText);
}

export function responseMentionsRequirementDocs(responseText: string): boolean {
  return REQUIREMENT_DOC_SIGNAL_REGEX.test(responseText);
}

export function responseMatchesServiceRequirements(
  responseText: string,
  requirements: Array<{ label?: string | null }>,
): boolean {
  const normalizedResponse = normalizeLooseText(responseText);
  if (!normalizedResponse) return false;

  return requirements.some((requirement) => {
    const normalizedLabel = normalizeLooseText(requirement.label || '');
    return normalizedLabel.length >= 3 && normalizedResponse.includes(normalizedLabel);
  });
}

export function serviceModeClaimConflicts(claim: string, dbMode: string): boolean {
  const normalizedClaim = normalizeLooseText(claim);
  const normalizedDbMode = normalizeLooseText(dbMode);
  if (!normalizedClaim || !normalizedDbMode) return false;

  if (normalizedClaim === 'both') {
    return normalizedDbMode !== 'both';
  }

  if (normalizedClaim === 'online') {
    return normalizedDbMode === 'offline';
  }

  if (normalizedClaim === 'offline') {
    return normalizedDbMode === 'online' || normalizedDbMode === 'both';
  }

  return false;
}
