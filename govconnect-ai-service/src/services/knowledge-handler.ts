/**
 * Knowledge Handler — answers knowledge / FAQ / village-info queries.
 *
 * Sub-handlers (address, hours, contact) use deterministic DB lookups
 * (anti-hallucination). Only general questions fall through to the
 * secondary callGemini() RAG path.
 */

import logger from '../utils/logger';
import axios from 'axios';
import { config } from '../config/env';
import { callGemini } from './llm.service';
import { buildKnowledgeQueryContext } from './context-builder.service';
import { searchKnowledge, searchKnowledgeKeywordsOnly, getVillageProfileSummary } from './knowledge.service';
import { getImportantContacts } from './important-contacts.service';
import {
  matchServiceSlug,
  classifyKnowledgeSubtype,
  matchContactQuery,
} from './micro-llm-matcher.service';
import {
  getPublicFormBaseUrl,
  buildPublicServiceFormUrl,
} from './ump-formatters';
import { setPendingServiceFormOffer } from './ump-state';
import { resolveVillageSlugForPublicForm } from './ump-utils';

// ──────────────── helpers (local) ────────────────

function normalizePhoneNumber(value: string): string {
  const digits = (value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('62')) return digits;
  return digits;
}

function extractPhoneNumbers(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/(\+?62|0)\s*\d[\d\s-]{7,14}\d/g) || [];
  const normalized = matches
    .map((raw) => normalizePhoneNumber(raw))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

// ──────────────── main export ────────────────

export async function handleKnowledgeQuery(
  userId: string,
  message: string,
  llmResponse: any,
  mainLlmReplyText?: string,
  channel: string = 'whatsapp',
): Promise<string> {
  logger.info('Handling knowledge query', { userId, knowledgeCategory: llmResponse.fields?.knowledge_category });

  try {
    const categories = llmResponse.fields?.knowledge_category
      ? [llmResponse.fields.knowledge_category]
      : undefined;
    const villageId: string | undefined = llmResponse.fields?.village_id;

    const normalizedQuery = (message || '').toLowerCase();
    const profile = await getVillageProfileSummary(villageId);
    const officeName = profile?.name || 'kantor desa/kelurahan';

    // ─── Micro-NLU subtype classification ───
    const knowledgeSubtype = await classifyKnowledgeSubtype(message, {
      village_id: villageId,
      wa_user_id: userId,
      session_id: userId,
      channel,
    });
    const subtypeResult = knowledgeSubtype?.subtype || 'general';

    // ─── Deterministic: Address ───
    if (subtypeResult === 'address') {
      return answerAddress(profile, officeName);
    }

    // ─── Deterministic: Operating hours ───
    if (subtypeResult === 'hours') {
      return answerHours(profile, officeName, normalizedQuery);
    }

    // ─── Deterministic: Contact ───
    if (subtypeResult === 'contact') {
      return await answerContact(
        message,
        knowledgeSubtype?.contact_entity || null,
        villageId,
        profile,
        officeName,
        userId,
        channel,
        categories,
      );
    }

    // ─── Service-catalog match (micro-LLM) ───
    let cachedServiceMatch: { matched_slug: string; confidence: number } | null = null;
    let cachedActiveServices: any[] | null = null;

    const catalogAnswer = await tryAnswerFromServiceCatalog(
      normalizedQuery,
      villageId,
      userId,
      (match, services) => {
        cachedServiceMatch = match;
        cachedActiveServices = services;
      },
    );
    if (catalogAnswer) return catalogAnswer;

    // ─── RAG context retrieval ───
    const preloadedContext: string | undefined = llmResponse.fields?._preloaded_knowledge_context;
    let contextString = preloadedContext;
    let total = contextString ? 1 : 0;

    if (!contextString) {
      const knowledgeResult = await searchKnowledge(message, categories, villageId);
      total = knowledgeResult.total;
      contextString = knowledgeResult.context;
    }

    // ─── Deterministic KB extraction (anchored terms) ───
    const deterministicFromContext = contextString
      ? tryExtractDeterministicKbAnswer(normalizedQuery, contextString)
      : null;
    if (deterministicFromContext) {
      return await appendServiceOfferIfNeeded(
        deterministicFromContext,
        normalizedQuery,
        villageId,
        cachedServiceMatch,
        cachedActiveServices,
      );
    }

    // Force keyword-only KB lookup for specific anchored terms
    const wants5w1h = /\b5w1h\b/i.test(normalizedQuery);
    const wantsPriority = /prioritas/i.test(normalizedQuery);
    const wantsEmbedding = /\bembedding\b/i.test(normalizedQuery);
    const wantsDataPurpose =
      /\bdata\b/i.test(normalizedQuery) && /(digunakan|tujuan)/i.test(normalizedQuery);
    if (wants5w1h || wantsPriority || wantsEmbedding || wantsDataPurpose) {
      const forcedQuery = wants5w1h
        ? '5W1H What Where When Who Why How'
        : wantsPriority
          ? 'Prioritas Penanganan Tinggi Sedang Rendah'
          : wantsEmbedding
            ? 'Embedding vektor pencarian'
            : 'Tujuan Penggunaan Data proses layanan pengaduan diakses admin';

      const kw = await searchKnowledgeKeywordsOnly(forcedQuery, undefined, villageId);
      if (kw?.context) {
        const deterministicFromKeyword = tryExtractDeterministicKbAnswer(normalizedQuery, kw.context);
        if (deterministicFromKeyword) return deterministicFromKeyword;
        contextString = [contextString, kw.context].filter(Boolean).join('\n\n---\n\n');
        total = Math.max(total, kw.total || 0);
      }
    }

    if (!contextString || total === 0) {
      return `Maaf, saya belum memiliki informasi tentang hal tersebut untuk *${officeName}*. Jika perlu, silakan hubungi atau datang langsung ke kantor pada jam kerja.`;
    }

    // Skip second LLM call when main LLM already produced a substantive answer
    const hasPreloaded = !!preloadedContext;
    if (hasPreloaded && mainLlmReplyText && mainLlmReplyText.length > 50) {
      const isGeneric =
        /(saya akan|saya cari|mencari informasi|berikut informasi yang saya|sedang mencari)/i.test(
          mainLlmReplyText,
        );
      if (!isGeneric) {
        logger.info('[KnowledgeQuery] Reusing main LLM reply, skipping second callGemini', {
          userId,
          replyLength: mainLlmReplyText.length,
        });
        return await appendServiceOfferIfNeeded(
          mainLlmReplyText,
          normalizedQuery,
          villageId,
          cachedServiceMatch,
          cachedActiveServices,
        );
      }
    }

    const { systemPrompt } = await buildKnowledgeQueryContext(userId, message, contextString);
    const knowledgeResult2 = await callGemini(systemPrompt);

    if (!knowledgeResult2) {
      return 'Maaf, terjadi kendala teknis. Silakan coba lagi dalam beberapa saat.';
    }

    return await appendServiceOfferIfNeeded(
      knowledgeResult2.response.reply_text,
      normalizedQuery,
      villageId,
      cachedServiceMatch,
      cachedActiveServices,
    );
  } catch (error: any) {
    logger.error('Failed to handle knowledge query', { userId, error: error.message });
    return 'Maaf, terjadi kesalahan saat mencari informasi. Mohon coba lagi dalam beberapa saat.';
  }
}

// ════════════════ Sub-handlers ════════════════

function answerAddress(profile: any, officeName: string): string {
  if (!profile?.address && !profile?.gmaps_url) {
    return 'Mohon maaf Pak/Bu, informasi alamat kantor belum tersedia. Silakan datang langsung ke kantor desa/kelurahan pada jam kerja.';
  }
  if (profile?.address && profile?.gmaps_url) {
    return `Kantor ${officeName} beralamat di ${profile.address}.\nLokasi Google Maps:\n${profile.gmaps_url}`;
  }
  if (profile?.address) {
    return `Alamat Kantor ${officeName} adalah ${profile.address}.`;
  }
  return `Tentu Pak/Bu. Berikut lokasi Kantor ${officeName} di Google Maps:\n${profile.gmaps_url}`;
}

function answerHours(profile: any, officeName: string, normalizedQuery: string): string {
  const hours: any = profile?.operating_hours;
  if (!hours || typeof hours !== 'object') {
    return 'Mohon maaf Pak/Bu, informasi jam operasional belum tersedia. Silakan datang langsung ke kantor desa/kelurahan pada jam kerja.';
  }

  const dayKeys = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'] as const;
  const requestedDay = dayKeys.find((d) => new RegExp(`\\b${d}\\b`, 'i').test(normalizedQuery));

  const formatDay = (day: string, schedule: any): string => {
    const open = schedule?.open ?? null;
    const close = schedule?.close ?? null;
    if (!open || !close) return `${day.charAt(0).toUpperCase() + day.slice(1)}: Tutup`;
    return `${day.charAt(0).toUpperCase() + day.slice(1)}: ${open}–${close}`;
  };

  if (requestedDay) {
    const daySchedule = (hours as any)[requestedDay];
    if (!daySchedule?.open || !daySchedule?.close) {
      const dayLabel = requestedDay.charAt(0).toUpperCase() + requestedDay.slice(1);
      if (requestedDay === 'sabtu' || requestedDay === 'minggu') {
        return 'Mohon maaf Pak/Bu, kantor tidak beroperasi pada hari Sabtu dan Minggu.';
      }
      return `Mohon maaf Pak/Bu, kantor tidak beroperasi pada hari ${dayLabel}.`;
    }
    const dayLabel = requestedDay.charAt(0).toUpperCase() + requestedDay.slice(1);
    return `Kantor ${officeName} buka hari ${dayLabel} pukul ${daySchedule.open}–${daySchedule.close}.`;
  }

  const weekdayKeys = ['senin', 'selasa', 'rabu', 'kamis', 'jumat'];
  const weekendKeys = ['sabtu', 'minggu'];
  const firstWeekday = (hours as any)[weekdayKeys[0]];
  const allWeekdaysSame = weekdayKeys.every((day) => {
    const h = (hours as any)[day];
    return h?.open === firstWeekday?.open && h?.close === firstWeekday?.close;
  });
  const weekendsClosed = weekendKeys.every((day) => {
    const h = (hours as any)[day];
    return !h?.open || !h?.close;
  });

  if (allWeekdaysSame && firstWeekday?.open && firstWeekday?.close && weekendsClosed) {
    return `Kantor ${officeName} buka Senin–Jumat, pukul ${firstWeekday.open}–${firstWeekday.close} WIB.`;
  }

  const lines: string[] = [`Jam operasional ${officeName}:`];
  for (const day of dayKeys) {
    lines.push(formatDay(day, (hours as any)[day]));
  }
  return lines.join('\n');
}

async function answerContact(
  message: string,
  contactEntity: string | null,
  villageId: string | undefined,
  profile: any,
  officeName: string,
  userId: string,
  channel: string,
  categories?: string[],
): Promise<string> {
  let contacts = await getImportantContacts(villageId || '');

  // Micro-NLU semantic matching
  if (contacts && contacts.length > 0 && contactEntity) {
    const contactMatchResult = await matchContactQuery(
      message,
      contacts.map((c) => ({
        name: c.name || '',
        description: c.description || '',
        category: c.category?.name || '',
      })),
      { village_id: villageId, wa_user_id: userId, session_id: userId, channel },
    );

    if (contactMatchResult && contactMatchResult.matched_indices.length > 0) {
      contacts = contactMatchResult.matched_indices.map((i) => contacts![i]).filter(Boolean);
    }
  }

  const dbPhoneSet = new Set(
    (contacts || []).map((c) => normalizePhoneNumber(c.phone || '')).filter(Boolean),
  );

  let kbPhoneCandidates: string[] = [];
  if (villageId) {
    const knowledgeResult = await searchKnowledge(message, categories, villageId);
    const kbContext = knowledgeResult?.context || '';
    kbPhoneCandidates = extractPhoneNumbers(kbContext);
  }

  const kbUnique = kbPhoneCandidates.filter((phone) => !dbPhoneSet.has(phone));

  if ((!contacts || contacts.length === 0) && kbUnique.length === 0) {
    const entityHint = contactEntity ? ` untuk ${contactEntity}` : '';
    return `Mohon maaf Pak/Bu, informasi nomor penting${entityHint} di ${officeName} belum tersedia.`;
  }

  const profileNameLower = (profile?.name || '').toLowerCase();
  const scored = contacts
    .map((c) => {
      const nameLower = (c.name || '').toLowerCase();
      let score = 0;
      if (profileNameLower && nameLower.includes(profileNameLower)) score += 5;
      if (/admin/i.test(nameLower)) score += 1;
      return { c, score };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, 3).map((s) => s.c);
  const hasDbContacts = top.length > 0;
  const lines: string[] = [hasDbContacts ? `Kontak ${officeName}:` : `Nomor penting ${officeName}:`];

  const formatPhone = (phone: string): string => {
    const digits = normalizePhoneNumber(phone);
    if (channel === 'whatsapp' && digits.startsWith('62')) {
      return `wa.me/${digits}`;
    }
    return phone;
  };

  for (const c of top) {
    const extra = c.description ? ` — ${c.description}` : '';
    lines.push(`- ${c.name}: ${formatPhone(c.phone || '')}${extra}`);
  }

  if (kbUnique.length > 0) {
    if (hasDbContacts) lines.push('\nNomor tambahan (KB):');
    for (const phone of kbUnique.slice(0, 3)) {
      const display = channel === 'whatsapp' && phone.startsWith('62') ? `wa.me/${phone}` : phone;
      lines.push(`- ${display}`);
    }
  }

  return lines.join('\n');
}

// ════════════════ Service catalog ════════════════

async function tryAnswerFromServiceCatalog(
  normalizedQuery: string,
  villageId: string | undefined,
  userId: string,
  cacheSetter: (
    match: { matched_slug: string; confidence: number } | null,
    services: any[] | null,
  ) => void,
): Promise<string | null> {
  try {
    const response = await axios.get(`${config.caseServiceUrl}/services`, {
      params: { village_id: villageId },
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 5000,
    });

    const services = Array.isArray(response.data?.data) ? response.data.data : [];
    if (!services.length) return null;

    const activeServices = services.filter((s: any) => s.is_active !== false);
    if (!activeServices.length) return null;

    const match = await matchServiceSlug(
      normalizedQuery,
      activeServices.map((s: any) => ({
        slug: s.slug || '',
        name: s.name || '',
        description: s.description || '',
      })),
      { village_id: villageId },
    );

    cacheSetter(
      match?.matched_slug ? { matched_slug: match.matched_slug, confidence: match.confidence } : null,
      activeServices,
    );

    if (!match?.matched_slug || match.confidence < 0.5) return null;
    const best = activeServices.find((s: any) => s.slug === match.matched_slug);
    if (!best) return null;

    logger.info('[KnowledgeQuery] Micro LLM matched service from catalog', {
      userId,
      query: normalizedQuery,
      matched_slug: match.matched_slug,
      confidence: match.confidence,
      reason: match.reason,
    });

    const requirements = best.requirements || [];
    let requirementsList = '';
    if (requirements.length > 0) {
      requirementsList = requirements
        .sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0))
        .map((req: any, i: number) => {
          const required = req.is_required ? ' (wajib)' : ' (opsional)';
          return `${i + 1}. ${req.label}${required}`;
        })
        .join('\n');
    }

    const isOnline = best.mode === 'online' || best.mode === 'both';
    let replyText = `Baik Pak/Bu, untuk ${best.name} persyaratannya antara lain:\n\n`;

    if (requirementsList) {
      replyText += `${requirementsList}\n\n`;
    } else if (best.description) {
      replyText += `${best.description}\n\n`;
    }

    if (isOnline) {
      setPendingServiceFormOffer(userId, {
        service_slug: best.slug,
        village_id: villageId,
        timestamp: Date.now(),
      });
      const baseUrl = getPublicFormBaseUrl();
      const villageSlug = await resolveVillageSlugForPublicForm(villageId || '');
      const formUrl = buildPublicServiceFormUrl(baseUrl, villageSlug, best.slug, userId, 'whatsapp');
      replyText += `Jika ingin mengajukan layanan ini secara online, silakan klik link berikut:\n${formUrl}`;
    } else {
      replyText += 'Layanan ini diproses secara offline di kantor kelurahan/desa.\n\nSilakan datang ke kantor dengan membawa persyaratan di atas.';
    }

    return replyText;
  } catch (error: any) {
    logger.warn('Service catalog lookup failed', { error: error.message });
    return null;
  }
}

// ════════════════ Deterministic KB extraction ════════════════

function tryExtractDeterministicKbAnswer(queryLower: string, ctx: string): string | null {
  const context = ctx || '';

  // 5W1H
  if (
    /\b5w1h\b/i.test(queryLower) &&
    /(\bwhat\b\s*:|\bwhere\b\s*:|\bwhen\b\s*:|\bwho\b\s*:)/i.test(context)
  ) {
    const labels = ['What', 'Where', 'When', 'Who', 'Why/How'] as const;
    const lines: string[] = ['Prinsip 5W1H untuk laporan:'];
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = context.match(
        new RegExp(`(^|\\n)\\s*[-*]\\s*(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*:\\s*([^\\n]+)`, 'i'),
      );
      if (match?.[2]) lines.push(`- ${label}: ${match[2].trim()}`);
    }
    if (lines.length >= 3) return lines.join('\n');
  }

  // Prioritas penanganan
  if (/prioritas/i.test(queryLower) && /(tinggi\s*:|sedang\s*:|rendah\s*:)/i.test(context)) {
    const labels = ['Tinggi', 'Sedang', 'Rendah'] as const;
    const lines: string[] = ['Prioritas penanganan pengaduan:'];
    for (const label of labels) {
      const match = context.match(
        new RegExp(`(^|\\n)\\s*[-*]\\s*(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:\\s*([^\\n]+)`, 'i'),
      );
      if (match?.[2]) lines.push(`- ${label}: ${match[2].trim()}`);
    }
    if (lines.length >= 3) return lines.join('\n');
  }

  // Embedding (glossary)
  if (/\bembedding\b/i.test(queryLower)) {
    const match = context.match(
      /(^|\n)\s*[-*]\s*(?:\*\*)?Embedding(?:\*\*)?\s*:\s*([^\n]+)/i,
    );
    if (match?.[2]) return `Embedding: ${match[2].trim()}`;
  }

  // Data usage purpose
  if (/\bdata\b/i.test(queryLower) && /(digunakan|tujuan)/i.test(queryLower)) {
    const usedForProses = context.match(
      /data\s+digunakan\s+untuk\s+(proses\s+layanan[^\n]*)/i,
    );
    const usedForGeneric = context.match(/data\s+digunakan\s+untuk\s+([^\n]+)/i);
    const usedTail = (usedForProses?.[1] || usedForGeneric?.[1])?.trim();
    const accessedBy = context.match(/data\s+hanya\s+diakses\s+oleh\s+([^\n]+)/i);
    if (usedTail || accessedBy?.[1]) {
      const lines: string[] = ['Tujuan penggunaan data layanan digital:'];
      if (usedTail) lines.push(`- Data digunakan untuk ${usedTail}`);
      if (accessedBy?.[1]) lines.push(`- Data hanya diakses oleh ${accessedBy[1].trim()}`);
      return lines.join('\n');
    }
  }

  return null;
}

// ════════════════ Service-offer append ════════════════

async function appendServiceOfferIfNeeded(
  text: string,
  normalizedQuery: string,
  villageId: string | undefined,
  cachedMatch: { matched_slug: string; confidence: number } | null,
  cachedServices: any[] | null,
): Promise<string> {
  if (!text) return text;
  // Already contains an offer
  if (/(ajukan|mengajukan|link|formulir)/i.test(text)) return text;

  try {
    if (cachedMatch && cachedMatch.confidence >= 0.5) {
      return `${text}\n\nJika Bapak/Ibu ingin mengajukan layanan ini, kami bisa bantu kirimkan link pengajuan.`;
    }

    if (cachedMatch === null && cachedServices === null) {
      const svcResp = await axios.get(`${config.caseServiceUrl}/services`, {
        params: { village_id: villageId },
        headers: { 'x-internal-api-key': config.internalApiKey },
        timeout: 5000,
      });
      const services = Array.isArray(svcResp.data?.data) ? svcResp.data.data : [];
      if (services.length > 0) {
        const activeServices = services.filter((s: any) => s.is_active !== false);
        const match = await matchServiceSlug(
          normalizedQuery,
          activeServices.map((s: any) => ({
            slug: s.slug || '',
            name: s.name || '',
            description: s.description || '',
          })),
          { village_id: villageId },
        );
        if (match?.matched_slug && match.confidence >= 0.5) {
          return `${text}\n\nJika Bapak/Ibu ingin mengajukan layanan ini, kami bisa bantu kirimkan link pengajuan.`;
        }
      }
    }
  } catch {
    // Silently skip — the offer is just a nice-to-have
  }
  return text;
}
