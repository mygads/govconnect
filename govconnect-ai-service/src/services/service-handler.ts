/**
 * Service Handler — handles service info, service request creation,
 * service request edit links, and service slug resolution.
 */

import logger from '../utils/logger';
import axios from 'axios';
import { config } from '../config/env';
import { requestServiceRequestEditToken, getServiceCatalog } from './case-client.service';
import { matchServiceSlug } from './micro-llm-matcher.service';
import type { ChannelType, HandlerResult } from './ump-formatters';
import {
  formatClickableLink,
  buildChannelParams,
  getPublicFormBaseUrl,
  buildPublicServiceFormUrl,
  buildEditServiceFormUrl,
} from './ump-formatters';
import { serviceSearchCache, setPendingServiceFormOffer } from './ump-state';
import { resolveVillageSlugForPublicForm } from './ump-utils';

// ==================== SERVICE CATALOG TEXT FOR PROMPT ====================

/**
 * Build a brief service catalog summary for injection into LLM prompt.
 * Fetches active services from Case Service DB and formats as a concise list
 * so the LLM knows what services are ACTUALLY available for this village.
 *
 * Similar pattern to `buildComplaintCategoriesText()` in complaint-handler.ts.
 */
export async function buildServiceCatalogText(villageId?: string): Promise<string> {
  try {
    const services = await getServiceCatalog(villageId);
    const active = services.filter(s => s.is_active);
    if (!active.length) {
      return '(Belum ada layanan yang terdaftar di sistem untuk desa ini)';
    }

    // Group by category
    const categoryMap = new Map<string, string[]>();
    for (const svc of active) {
      const catName = svc.category?.name || 'Umum';
      if (!categoryMap.has(catName)) categoryMap.set(catName, []);
      categoryMap.get(catName)!.push(`${svc.name} [${svc.slug}]`);
    }

    const lines: string[] = [];
    for (const [category, items] of categoryMap) {
      lines.push(`- ${category}: ${items.join(', ')}`);
    }
    return lines.join('\n');
  } catch (error: any) {
    logger.warn('Failed to build service catalog text', { error: error.message });
    return '(Daftar layanan tidak tersedia saat ini — sistem tetap bisa mencocokkan layanan secara otomatis)';
  }
}

// ==================== SERVICE SLUG RESOLUTION ====================

export async function resolveServiceSlugFromSearch(query: string, villageId?: string): Promise<{ slug: string; name?: string; alternatives?: Array<{ slug: string; name: string }> } | null> {
  const trimmedQuery = (query || '').trim();
  if (!trimmedQuery) return null;

  const searchQuery = trimmedQuery;

  // Check service search cache first (M3 optimization)
  const cacheKey = `${villageId || ''}:${searchQuery.toLowerCase()}`;
  const cached = serviceSearchCache.get(cacheKey);
  if (cached) {
    logger.debug('resolveServiceSlugFromSearch: served from cache', { query: trimmedQuery, slug: cached.slug });
    return { slug: cached.slug, name: cached.name };
  }
  try {
    // Fetch candidate services from Case Service
    const response = await axios.get(`${config.caseServiceUrl}/services/search`, {
      params: {
        village_id: villageId,
        q: searchQuery,
        limit: 10,
      },
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 5000,
    });

    let services = Array.isArray(response.data?.data) ? response.data.data : [];
    if (!services.length && villageId) {
      const fallbackResponse = await axios.get(`${config.caseServiceUrl}/services`, {
        params: { village_id: villageId },
        headers: { 'x-internal-api-key': config.internalApiKey },
        timeout: 5000,
      });
      services = Array.isArray(fallbackResponse.data?.data) ? fallbackResponse.data.data : [];
    }
    if (!services.length) return null;

    // Use micro LLM for semantic matching
    const options = services
      .filter((s: any) => s?.slug)
      .map((s: any) => ({
        slug: String(s.slug),
        name: String(s.name || ''),
        description: String(s.description || ''),
      }));

    if (!options.length) return null;

    const result = await matchServiceSlug(searchQuery, options);

    if (result?.matched_slug && result.confidence >= 0.5) {
      const matched = services.find((s: any) => s.slug === result.matched_slug);
      if (matched) {
        logger.debug('resolveServiceSlugFromSearch: Micro LLM match', {
          query: searchQuery,
          matched_slug: result.matched_slug,
          confidence: result.confidence,
          reason: result.reason,
        });
        const matchResult = { slug: String(matched.slug), name: String(matched.name || '') };
        serviceSearchCache.set(cacheKey, { ...matchResult, timestamp: Date.now() });
        return matchResult;
      }
    }

    // If ambiguous, return with alternatives
    if (!result?.matched_slug && result?.alternatives && result.alternatives.length > 1) {
      logger.info('resolveServiceSlugFromSearch: Ambiguous match, returning alternatives', {
        query: searchQuery,
        alternatives: result.alternatives,
      });
      return { slug: '', name: '', alternatives: result.alternatives };
    }

    logger.debug('resolveServiceSlugFromSearch: No match via micro LLM', { query: trimmedQuery });
    return null;
  } catch (error: any) {
    logger.warn('Service search lookup failed', { error: error.message, villageId });
    return null;
  }
}

// ==================== SERVICE INFO ====================

export async function handleServiceInfo(userId: string, llmResponse: any, channel: ChannelType = 'whatsapp'): Promise<HandlerResult> {
  let { service_slug, service_id } = llmResponse.fields || {};
  const villageId = llmResponse.fields?.village_id || '';
  const rawMessage = llmResponse.fields?._original_message || llmResponse.fields?.service_name || llmResponse.fields?.service_query || '';

  if (!service_slug && !service_id && rawMessage) {
    const resolved = await resolveServiceSlugFromSearch(rawMessage, villageId);
    if (resolved?.alternatives && resolved.alternatives.length > 1) {
      const optionsList = resolved.alternatives.map((a, i) => `${i + 1}. ${a.name}`).join('\n');
      return { replyText: `Mohon maaf Pak/Bu, ada beberapa layanan yang cocok:\n\n${optionsList}\n\nMohon pilih salah satu dengan menyebutkan nama lengkap layanannya.` };
    }
    if (resolved?.slug) {
      service_slug = resolved.slug;
      llmResponse.fields = {
        ...(llmResponse.fields || {}),
        service_slug: resolved.slug,
        service_name: resolved.name || llmResponse.fields?.service_name,
      } as any;
    }
  }

  if (!service_slug && !service_id) {
    return { replyText: llmResponse.reply_text || 'Baik Pak/Bu, layanan apa yang ingin ditanyakan?' };
  }

  try {
    const fetchService = async (slug?: string, id?: string) => {
      let serviceUrl = '';
      if (id) {
        serviceUrl = `${config.caseServiceUrl}/services/${id}`;
      } else if (slug) {
        serviceUrl = `${config.caseServiceUrl}/services/by-slug?village_id=${villageId}&slug=${slug}`;
      }
      if (!serviceUrl) return null;
      try {
        const response = await axios.get(serviceUrl, {
          headers: { 'x-internal-api-key': config.internalApiKey },
          timeout: 5000,
        });
        return response.data?.data || null;
      } catch (error: any) {
        if (error.response?.status === 404) return null;
        throw error;
      }
    };

    let service = await fetchService(service_slug, service_id);

    if (!service && rawMessage) {
      const resolved = await resolveServiceSlugFromSearch(rawMessage, villageId);
      if (resolved?.slug) {
        service_slug = resolved.slug;
        service = await fetchService(resolved.slug, undefined);
      }
    }

    if (!service) {
      return { replyText: llmResponse.reply_text || 'Mohon maaf Pak/Bu, layanan tersebut tidak ditemukan. Silakan tanyakan layanan lain.' };
    }

    if (service.is_active === false) {
      return { replyText: `Mohon maaf Pak/Bu, layanan ${service.name} saat ini belum tersedia.` };
    }

    const resolvedVillageId = villageId || service.village_id || service.villageId || '';

    // Build requirements list
    const requirements = service.requirements || [];
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

    // Check if service is available online
    const isOnline = service.mode === 'online' || service.mode === 'both';
    const baseUrl = getPublicFormBaseUrl();
    const villageSlug = await resolveVillageSlugForPublicForm(resolvedVillageId || villageId);

    let replyText = `Baik Pak/Bu, untuk pembuatan ${service.name} persyaratannya antara lain:\n\n`;
    let guidanceText = '';

    if (requirementsList) {
      replyText += `${requirementsList}\n\n`;
    } else if (service.description) {
      replyText += `${service.description}\n\n`;
    }

    if (isOnline) {
      setPendingServiceFormOffer(userId, {
        service_slug: service.slug,
        village_id: resolvedVillageId || villageId,
        timestamp: Date.now(),
      });

      const formUrl = buildPublicServiceFormUrl(baseUrl, villageSlug, service.slug, userId, channel === 'webchat' ? 'webchat' : 'whatsapp');
      guidanceText = `Jika ingin mengajukan layanan ini secara online, silakan klik link berikut:\n${formUrl}`;
    } else {
      replyText += 'Layanan ini diproses secara offline di kantor desa/kelurahan.\n\nSilakan datang ke kantor dengan membawa persyaratan di atas.';
    }

    return { replyText, guidanceText: guidanceText || undefined };
  } catch (error: any) {
    logger.error('Failed to fetch service info', { error: error.message, service_slug, service_id });
    return { replyText: llmResponse.reply_text || 'Baik Pak/Bu, saya cek dulu info layanan tersebut ya.' };
  }
}

// ==================== SERVICE REQUEST CREATION ====================

export async function handleServiceRequestCreation(userId: string, channel: ChannelType, llmResponse: any): Promise<string> {
  let { service_slug } = llmResponse.fields || {};
  const rawMessage = llmResponse.fields?._original_message || llmResponse.fields?.service_name || llmResponse.fields?.service_query || '';
  let villageId = llmResponse.fields?.village_id || '';

  if (!service_slug && rawMessage) {
    const resolved = await resolveServiceSlugFromSearch(rawMessage, villageId);
    if (resolved?.slug) {
      service_slug = resolved.slug;
      llmResponse.fields = {
        ...(llmResponse.fields || {}),
        service_slug: resolved.slug,
        service_name: resolved.name || llmResponse.fields?.service_name,
      } as any;
    }
  }

  if (!service_slug) {
    return llmResponse.reply_text || 'Mohon sebutkan nama layanan yang ingin diajukan ya Pak/Bu.';
  }

  try {
    let response = await axios.get(`${config.caseServiceUrl}/services/by-slug`, {
      params: { village_id: villageId, slug: service_slug },
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 5000,
    }).catch(() => null);

    let service = response?.data?.data;

    if (!service) {
      logger.info('Service not found by slug, trying search', { service_slug, villageId });
      const searchQuery = service_slug.replace(/-/g, ' ');
      const resolved = await resolveServiceSlugFromSearch(searchQuery, villageId);
      if (resolved?.slug) {
        service_slug = resolved.slug;
        response = await axios.get(`${config.caseServiceUrl}/services/by-slug`, {
          params: { village_id: villageId, slug: service_slug },
          headers: { 'x-internal-api-key': config.internalApiKey },
          timeout: 5000,
        }).catch(() => null);
        service = response?.data?.data;
      }
    }

    if (!service) {
      return 'Mohon maaf Pak/Bu, layanan tersebut tidak ditemukan. Silakan tanyakan layanan lain.';
    }

    if (service.is_active === false) {
      return `Mohon maaf Pak/Bu, layanan ${service.name} saat ini belum tersedia.`;
    }

    if (!villageId && (service.village_id || service.villageId)) {
      villageId = service.village_id || service.villageId;
    }

    const isOnline = service.mode === 'online' || service.mode === 'both';
    if (!isOnline) {
      return `${service.name} saat ini hanya bisa diproses secara offline di kantor kelurahan/desa.\n\nSilakan datang ke kantor dengan membawa persyaratan yang diperlukan.`;
    }

    const baseUrl = getPublicFormBaseUrl();
    const villageSlug = await resolveVillageSlugForPublicForm(villageId);
    const formUrl = buildPublicServiceFormUrl(baseUrl, villageSlug, service.slug || service_slug, userId, channel === 'webchat' ? 'webchat' : 'whatsapp');

    const clickableUrl = formatClickableLink(formUrl, channel, 'Link Formulir Layanan');
    return `Baik Pak/Bu, silakan mengisi permohonan melalui link berikut:\n${clickableUrl}\n\nSetelah dikirim, Bapak/Ibu akan mendapatkan nomor layanan.\n⚠️ Mohon simpan nomor layanan dengan baik.\nUntuk cek status, ketik: *status <kode layanan>*\n(Contoh: status LAY-20250209-001)`;
  } catch (error: any) {
    logger.error('Failed to validate service before sending form link', { error: error.message, service_slug, villageId });
    return llmResponse.reply_text || 'Mohon maaf Pak/Bu, saya belum bisa menyiapkan link formulirnya sekarang. Coba lagi sebentar ya.';
  }
}

// ==================== SERVICE REQUEST EDIT ====================

export async function handleServiceRequestEditLink(userId: string, channel: ChannelType, llmResponse: any): Promise<string> {
  const { request_number } = llmResponse.fields || {};

  if (!request_number) {
    return llmResponse.reply_text || 'Baik Pak/Bu, link tersebut sudah tidak berlaku. Apakah Bapak/Ibu ingin kami kirimkan link pembaruan yang baru?';
  }

  const tokenResult = await requestServiceRequestEditToken(request_number, buildChannelParams(channel, userId));

  if (!tokenResult.success) {
    if (tokenResult.error === 'NOT_FOUND') {
      return `Permohonan layanan *${request_number}* tidak ditemukan. Mohon cek nomor layanan ya Pak/Bu.`;
    }
    if (tokenResult.error === 'NOT_OWNER') {
      return `Mohon maaf Pak/Bu, permohonan *${request_number}* bukan milik Anda, jadi tidak bisa diubah.`;
    }
    if (tokenResult.error === 'LOCKED') {
      return `Mohon maaf Pak/Bu, layanan *${request_number}* sudah selesai/dibatalkan/ditolak sehingga tidak dapat diperbarui.`;
    }
    return tokenResult.message || 'Mohon maaf Pak/Bu, ada kendala saat menyiapkan link edit.';
  }

  const baseUrl = (process.env.PUBLIC_FORM_BASE_URL || process.env.PUBLIC_BASE_URL || 'https://govconnect.my.id').replace(/\/$/, '');
  const editUrl = buildEditServiceFormUrl(
    baseUrl,
    request_number,
    tokenResult.edit_token || '',
    userId,
    channel === 'webchat' ? 'webchat' : 'whatsapp'
  );

  const clickableEditUrl = formatClickableLink(editUrl, channel, 'Link Edit Permohonan');
  return `Baik Pak/Bu, perubahan data layanan hanya dapat dilakukan melalui website.\n\nSilakan lakukan pembaruan melalui link berikut:\n${clickableEditUrl}\n\nLink ini hanya berlaku satu kali.`;
}
