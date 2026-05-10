import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';

export interface ImportantContact {
  id: string;
  name: string;
  phone: string;
  description?: string | null;
  category?: {
    id: string;
    name: string;
  };
}

/**
 * Match origin — which signal scored the contact.
 */
export type ContactMatchSource =
  | 'exact_name'
  | 'name_contains_query'
  | 'query_contains_name'
  | 'alias_name'
  | 'alias_description'
  | 'alias_category'
  | 'role_match'
  | 'token_overlap'
  | 'locality'
  | 'alias_fallback';

export interface ImportantContactMatch {
  contact: ImportantContact;
  /** Normalized score in the 0..1 range. */
  score: number;
  /** Ordered list of signals that contributed. Most important first. */
  matchedBy: ContactMatchSource[];
  /** Raw positive score for debugging/traces. */
  rawScore: number;
}

export type ContactCategoryHint = 'emergency' | 'government' | 'utility' | 'religion' | 'health' | null;
export type ContactRoleHint = 'kades' | 'sekdes' | 'camat' | 'rt' | 'rw' | 'damkar' | 'polisi' | 'puskesmas' | 'ambulans' | 'bidan' | 'bencana' | 'pln' | 'pdam' | null;

export interface ContactLookupResult {
  matches: ImportantContactMatch[];
  total_candidates: number;
  category_hint: ContactCategoryHint;
  role_hint: ContactRoleHint;
}

export async function getImportantContacts(
  villageId: string,
  categoryName?: string | null,
  categoryId?: string | null
): Promise<ImportantContact[]> {
  if (!villageId) {
    logger.warn('getImportantContacts called without villageId');
    return [];
  }

  try {
    const url = `${config.dashboardServiceUrl}/api/internal/important-contacts`;

    logger.debug('📞 Fetching important contacts', {
      url,
      villageId,
      categoryName,
      categoryId,
    });

    const response = await axios.get<{ data: ImportantContact[] }>(url, {
      headers: {
        'x-internal-api-key': config.internalApiKey,
        'Content-Type': 'application/json',
      },
      params: {
        village_id: villageId,
        ...(categoryName ? { category_name: categoryName } : {}),
        ...(categoryId ? { category_id: categoryId } : {}),
      },
      timeout: 10000,
    });

    const contacts = response.data.data || [];
    logger.debug('📞 Important contacts fetched', {
      villageId,
      categoryName,
      count: contacts.length,
      contactNames: contacts.slice(0, 3).map(c => c.name),
    });

    return contacts;
  } catch (error: any) {
    logger.warn('Failed to fetch important contacts', {
      error: error.message,
      status: error.response?.status,
    });
    return [];
  }
}

// ==================== CONTACT DIRECTORY LOOKUP ====================

/**
 * Normalize Indonesian entity names: lowercase, strip punctuation, collapse spaces.
 */
function normalizeEntityText(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Aliases for common role/entity keywords. Used for:
 * - detecting whether a user message is asking about a specific role
 * - scoring contact records that match the role
 */
const ROLE_ALIASES: Record<NonNullable<ContactRoleHint>, string[]> = {
  damkar: ['damkar', 'pemadam', 'pemadam kebakaran', 'pmk', 'kebakaran'],
  polisi: ['polisi', 'polsek', 'polres', 'kepolisian', 'danpos', 'kamtibmas', 'babinkamtibmas', 'pospol'],
  ambulans: ['ambulans', 'ambulan', 'gawat darurat medis'],
  puskesmas: ['puskesmas', 'pustu', 'puskesmas pembantu', 'poliklinik', 'klinik desa'],
  bidan: ['bidan', 'bidan desa'],
  kades: ['kepala desa', 'kades', 'pak desa', 'bu desa', 'pak kades'],
  sekdes: ['sekdes', 'sekretaris desa'],
  camat: ['kecamatan', 'camat', 'pak camat', 'kantor camat', 'kantor kecamatan'],
  rt: ['rt', 'ketua rt', 'pak rt', 'bu rt'],
  rw: ['rw', 'ketua rw', 'pak rw', 'bu rw'],
  bencana: ['bnpb', 'bpbd', 'penanggulangan bencana', 'sar', 'basarnas', 'pencarian dan pertolongan'],
  pln: ['pln', 'listrik mati', 'pemadaman listrik'],
  pdam: ['pdam', 'air mati'],
};

const CATEGORY_HINT_BY_ROLE: Record<NonNullable<ContactRoleHint>, ContactCategoryHint> = {
  damkar: 'emergency',
  polisi: 'emergency',
  ambulans: 'emergency',
  puskesmas: 'health',
  bidan: 'health',
  kades: 'government',
  sekdes: 'government',
  camat: 'government',
  rt: 'government',
  rw: 'government',
  bencana: 'emergency',
  pln: 'utility',
  pdam: 'utility',
};

/**
 * Broad category hint keywords used when widening a search.
 */
export const CATEGORY_HINT_KEYWORDS: Record<Exclude<NonNullable<ContactCategoryHint>, never>, string[]> = {
  emergency: ['damkar', 'pemadam', 'kebakaran', 'polisi', 'polsek', 'ambulans', 'ambulan', 'darurat', 'bencana', 'sar', 'basarnas', 'kecelakaan'],
  government: ['desa', 'kepala', 'kades', 'sekdes', 'sekretaris', 'kecamatan', 'camat', 'rt', 'rw'],
  utility: ['pln', 'pdam', 'listrik', 'air'],
  religion: ['masjid', 'mushola', 'pondok', 'dkm', 'takmir'],
  health: ['puskesmas', 'pustu', 'bidan', 'posyandu', 'poliklinik', 'klinik'],
};

/**
 * Entity / role keywords that, when combined with a directory verb, make a
 * message clearly a directory lookup ("ada nomor X", "kontak Y").
 */
const DIRECTORY_ENTITY_PATTERN =
  /\b(kepala\s*desa|kades|lurah|pak\s*desa|bu\s*desa|sekdes|sekretaris\s*desa|camat|pak\s*camat|kecamatan|kantor\s*kecamatan|kantor\s*desa|admin|petugas|rt(?:\s*\d+)?|rw(?:\s*\d+)?|babinsa|babinkamtibmas|damkar|pemadam(?:\s*kebakaran)?|pmk|polisi|polsek|polres|danpos|kamtibmas|pospol|bhabinkamtibmas|puskesmas|pustu|poliklinik|klinik\s*desa|posyandu|bidan(?:\s*desa)?|rumah\s*sakit|\brsud?\b|ambulans?|bpbd|bnpb|sar|basarnas|penanggulangan\s*bencana|pln|pdam|dkm|takmir|masjid|mushola)\b/i;

/**
 * Directory verbs — "ada nomor X", "minta kontak Y", "telpon Z".
 * Must be combined with DIRECTORY_ENTITY_PATTERN to count as a lookup so we
 * don't misclassify short replies like "nomor 2" inside a pending flow.
 */
const DIRECTORY_VERB_PATTERN =
  /\b(?:ada\s+(?:no(?:mor)?|telp|telpon|telepon|kontak)|(?:no(?:mor)?|nomer|telp|telpon|telepon|kontak|hubungi|call)\s+|minta\s+(?:no(?:mor)?|kontak)|mohon\s+(?:no(?:mor)?|kontak)|tolong\s+(?:no(?:mor)?|kontak)|siapa\s+(?:yang\s+)?bisa\s+dihubungi)/i;

const ACTIVE_EMERGENCY_PATTERNS = [
  /\b(tolong|bantu|cepat|segera|darurat|sekarang|saat ini)\b.*\b(kebakaran|kecelakaan|pingsan|banjir|longsor|bencana|gempa|ledakan|evakuasi)\b/i,
  /\b(kebakaran|kecelakaan|pingsan|banjir|longsor|bencana|gempa|ledakan|evakuasi)\b.*\b(sekarang|saat ini|disini|di sini|barusan|tadi|tolong|bantu)\b/i,
  /\b(ada\s+(kebakaran|kecelakaan|orang\s+pingsan|bencana|ledakan|banjir\s+bandang))\b/i,
  /\b(rumah\s+(saya|kami)\s+kebakaran)\b/i,
];

/**
 * Detect whether a message is asking for a contact from the directory
 * (e.g. "ada nomor damkar?", "nomor kepala desa?", "kontak polsek"),
 * as opposed to reporting an active emergency or replying to a pending flow.
 *
 * Rule: requires a directory verb AND a contact entity keyword. This avoids
 * false positives on short replies like "nomor 2" that are actually ordinal
 * selections inside a pending clarification.
 */
export function isContactDirectoryLookup(message: string): boolean {
  const raw = (message || '').trim();
  if (!raw) return false;
  if (raw.length < 3) return false;

  // Never treat an active emergency report as a directory lookup.
  if (ACTIVE_EMERGENCY_PATTERNS.some((pattern) => pattern.test(message))) {
    return false;
  }

  // Negative guard — "nomor KTP/KK/NIK/KTM hilang" is about a document
  // identifier, not a person/office contact. Same for "nomor laporan/
  // layanan" (LAP-/LAY-).
  if (/\bno(?:mor)?\s+(?:k(?:tp|k)|nik|kartu|laporan|layanan|pengaduan|pelayanan|permohonan|pengajuan|surat|akta|sktm|skck|lay-|lap-)\b/i.test(message)) {
    return false;
  }
  // "nomor KK saya", "KTP hilang" style claims — document, not contact.
  if (/\b(k(?:tp|k)|nik|akta|sktm|skck)\b.*\b(hilang|rusak|baru|bikin|buat|perpanjang|perpanjangan|ganti|cetak|ubah)\b/i.test(message)) {
    return false;
  }

  const hasDirectoryVerb = DIRECTORY_VERB_PATTERN.test(message);
  const hasEntity = DIRECTORY_ENTITY_PATTERN.test(message);

  if (hasEntity && hasDirectoryVerb) return true;

  // Strong single-entity questions also qualify:
  // "nomor kepala desa?" -> verb + entity
  // "kepala desa siapa yang bisa dihubungi?" -> entity + hub verb
  const looksLikeQuestion = /[?]\s*$/.test(raw) || /^(apa|siapa|dimana|di mana|boleh|bisa)\b/i.test(raw);
  if (hasEntity && looksLikeQuestion && /\b(no(?:mor)?|nomer|telp|telpon|telepon|kontak|hubungi)\b/i.test(message)) {
    return true;
  }

  return false;
}

/**
 * Extract role hints from a query.
 * Returns the strongest role signal first.
 */
export function extractRoleHints(query: string): NonNullable<ContactRoleHint>[] {
  const normalized = normalizeEntityText(query);
  const hits: NonNullable<ContactRoleHint>[] = [];
  for (const [role, aliases] of Object.entries(ROLE_ALIASES) as [NonNullable<ContactRoleHint>, string[]][]) {
    if (aliases.some((alias) => normalized.includes(alias))) {
      hits.push(role);
    }
  }
  return hits;
}

/**
 * Build a haystack string from a contact for fuzzy matching.
 */
function contactHaystack(contact: ImportantContact): string {
  return normalizeEntityText(
    `${contact.name} ${contact.description || ''} ${contact.category?.name || ''}`,
  );
}

const STOPWORDS = new Set([
  'ada', 'nomor', 'no', 'telp', 'telpon', 'telepon', 'kontak', 'minta', 'mohon', 'tolong',
  'saya', 'pak', 'bu', 'yang', 'dari', 'ini', 'itu', 'desa', 'bisa', 'boleh', 'ke', 'di',
]);

/**
 * Score a single contact against a query with transparent, bounded heuristics.
 * Returns raw score and a list of signals.
 */
function scoreContact(contact: ImportantContact, rawQuery: string): {
  rawScore: number;
  signals: ContactMatchSource[];
} {
  const query = normalizeEntityText(rawQuery);
  if (!query) return { rawScore: 0, signals: [] };

  const contactName = normalizeEntityText(contact.name);
  const contactDesc = normalizeEntityText(contact.description || '');
  const contactCategory = normalizeEntityText(contact.category?.name || '');
  const haystack = `${contactName} ${contactDesc} ${contactCategory}`.trim();

  let score = 0;
  const signals: ContactMatchSource[] = [];

  if (contactName && contactName === query) {
    score += 10;
    signals.push('exact_name');
  } else if (contactName && contactName.length >= 3 && query.includes(contactName)) {
    score += 8;
    signals.push('query_contains_name');
  } else if (contactName && query.length >= 3 && contactName.includes(query)) {
    score += 6;
    signals.push('name_contains_query');
  }

  const roleHits = extractRoleHints(query);
  for (const role of roleHits) {
    const aliases = ROLE_ALIASES[role];
    if (aliases.some((alias) => contactName.includes(alias))) {
      score += 6;
      signals.push('alias_name');
    } else if (aliases.some((alias) => contactDesc.includes(alias))) {
      score += 5;
      signals.push('alias_description');
    } else if (aliases.some((alias) => contactCategory.includes(alias))) {
      score += 4;
      signals.push('alias_category');
    }
  }

  const queryTokens = query
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));

  const overlapTokens = queryTokens.filter((token) => haystack.includes(token));
  if (overlapTokens.length > 0) {
    score += Math.min(overlapTokens.length * 2, 6);
    signals.push('token_overlap');
  }

  const localitySignals = ['solo', 'bola', 'margahayu', 'dusun'];
  for (const signal of localitySignals) {
    if (query.includes(signal) && haystack.includes(signal)) {
      score += 1;
      signals.push('locality');
    }
  }

  return { rawScore: score, signals };
}

interface LookupOptions {
  limit?: number;
  /** Minimum raw score to keep a match. Defaults to 3. */
  minRawScore?: number;
  /** Explicit category hint to bias scoring (optional). */
  categoryHint?: ContactCategoryHint;
}

/**
 * First-class directory lookup.
 *
 * Steps:
 *  1. Pull all important contacts for the village.
 *  2. Score each contact against the query.
 *  3. Keep the top N matches above a minimum score.
 *  4. If nothing matched but the query mentioned a known role, fall back to any
 *     contact whose haystack contains a role alias (so common aliases always land).
 */
export async function lookupImportantContacts(
  query: string,
  villageId: string | undefined,
  options: LookupOptions = {},
): Promise<ContactLookupResult> {
  const trimmed = (query || '').trim();
  if (!villageId || !trimmed) {
    return { matches: [], total_candidates: 0, category_hint: null, role_hint: null };
  }

  const limit = options.limit ?? 3;
  const minRawScore = options.minRawScore ?? 3;

  const roleHits = extractRoleHints(trimmed);
  const roleHint: ContactRoleHint = roleHits[0] || null;
  let categoryHint: ContactCategoryHint = options.categoryHint ?? null;
  if (!categoryHint && roleHint) {
    categoryHint = CATEGORY_HINT_BY_ROLE[roleHint];
  }

  const contacts = await getImportantContacts(villageId);
  if (contacts.length === 0) {
    return { matches: [], total_candidates: 0, category_hint: categoryHint, role_hint: roleHint };
  }

  const categoryHintTerms = categoryHint && categoryHint in CATEGORY_HINT_KEYWORDS
    ? CATEGORY_HINT_KEYWORDS[categoryHint as keyof typeof CATEGORY_HINT_KEYWORDS]
    : [];

  type Scored = { contact: ImportantContact; rawScore: number; signals: ContactMatchSource[] };
  const scored: Scored[] = contacts
    .map((contact) => {
      const { rawScore, signals } = scoreContact(contact, trimmed);
      const haystack = contactHaystack(contact);

      let boost = 0;
      const boostedSignals = [...signals];
      if (categoryHintTerms.length > 0 && categoryHintTerms.some((term) => haystack.includes(term))) {
        boost += 1;
      }

      return {
        contact,
        rawScore: rawScore + boost,
        signals: boostedSignals,
      };
    })
    .filter((entry) => entry.rawScore >= minRawScore)
    .sort((a, b) => b.rawScore - a.rawScore)
    .slice(0, limit);

  let final: Scored[] = scored;

  // Fallback: alias-only match. If no contact passed the threshold but the
  // query is about a known role, return any contact whose haystack contains a
  // role alias so we never invent a number but also never falsely "not found"
  // when the data is there.
  if (final.length === 0 && roleHits.length > 0) {
    const aliasTerms = roleHits.flatMap((role) => ROLE_ALIASES[role]);
    const fallback = contacts
      .map((contact) => {
        const haystack = contactHaystack(contact);
        const hit = aliasTerms.find((alias) => haystack.includes(alias));
        if (!hit) return null;
        return {
          contact,
          rawScore: 3,
          signals: ['alias_fallback' as ContactMatchSource],
        } as Scored;
      })
      .filter((entry): entry is Scored => entry !== null)
      .slice(0, limit);
    final = fallback;
  }

  // Normalize score to 0..1 relative to the strongest signal (useful for agent logging).
  const maxRaw = final.reduce((max, entry) => Math.max(max, entry.rawScore), 0);
  const matches: ImportantContactMatch[] = final.map((entry) => ({
    contact: entry.contact,
    rawScore: entry.rawScore,
    score: maxRaw > 0 ? Math.min(1, entry.rawScore / Math.max(maxRaw, 10)) : 0,
    matchedBy: entry.signals,
  }));

  return {
    matches,
    total_candidates: contacts.length,
    category_hint: categoryHint,
    role_hint: roleHint,
  };
}

/**
 * Back-compat alias for any call-sites using the older name.
 */
export const matchImportantContactByQuery = lookupImportantContacts;
