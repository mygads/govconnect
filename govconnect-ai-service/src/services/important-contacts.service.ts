import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { retrieveContext } from './rag.service';

export interface DashboardImportantContactRow {
  name: string;
  phone: string;
  description?: string | null;
  category_name?: string | null;
}

export interface ImportantContact {
  name: string;
  phone: string;
  description?: string | null;
  wa_link: string;
}

export type ImportantContactSearchSource = 'DB' | 'KB';

export type ImportantContactSearchResult = {
  source: ImportantContactSearchSource;
  data: ImportantContact[];
};

export class ImportantContactsService {
  private normalizePhoneNumber(phone: string): string {
    const digitsOnly = (phone || '').replace(/\D/g, '');
    if (!digitsOnly) return '';

    if (digitsOnly.startsWith('08')) return `628${digitsOnly.slice(2)}`;
    if (digitsOnly.startsWith('8')) return `628${digitsOnly.slice(1)}`;
    if (digitsOnly.startsWith('62')) return digitsOnly;

    // Unknown / unexpected format
    return digitsOnly;
  }

  private async fetchDashboardContacts(villageId: string): Promise<DashboardImportantContactRow[]> {
    if (!villageId) return [];

    try {
      const url = `${config.dashboardServiceUrl}/api/internal/important-contacts`;
      const response = await axios.get<DashboardImportantContactRow[]>(url, {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        params: {
          village_id: villageId,
        },
        timeout: 10000,
      });

      return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
      logger.warn('Failed to fetch important contacts (raw)', {
        error: error.message,
        status: error.response?.status,
      });
      return [];
    }
  }

  private toImportantContact(row: DashboardImportantContactRow): ImportantContact | null {
    if (!row || typeof row.name !== 'string' || typeof row.phone !== 'string') return null;
    const normalized = this.normalizePhoneNumber(row.phone);
    const waLink = normalized ? `https://wa.me/${normalized}` : '';
    return {
      name: row.name,
      phone: row.phone,
      description: row.description ?? null,
      wa_link: waLink,
    };
  }

  private inferWantedCategories(query: string): Array<'Kebakaran' | 'Polisi' | 'Kesehatan' | 'Keamanan'> {
    const text = (query || '').toLowerCase();
    if (!text) return [];

    const wantsFire = /(\bkebakaran\b|\bapi\b|\bdamkar\b|\bpemadam\b|\bterbakar\b|\basap\b)/i.test(text);
    const wantsPolice = /(\bpolisi\b|\bpolsek\b|\bmaling\b|\bkejahatan\b|\bkriminal\b|\bpencurian\b|\bperampokan\b)/i.test(text);
    const wantsHealth = /(\bdokter\b|\bsakit\b|\bbidan\b|\bpuskesmas\b|\bambulans\b|\bambulance\b|\brumah\s*sakit\b|\bklinik\b)/i.test(text);
    const wantsSecurity = /(\baman\b|\bsatpam\b|\bhansip\b|\blinmas\b|\bsecurity\b)/i.test(text);

    const categories: Array<'Kebakaran' | 'Polisi' | 'Kesehatan' | 'Keamanan'> = [];
    if (wantsFire) categories.push('Kebakaran');
    if (wantsPolice) categories.push('Polisi');
    if (wantsHealth) categories.push('Kesehatan');
    if (wantsSecurity) categories.push('Keamanan');
    return categories;
  }

  private isGenericContactRequest(query: string): boolean {
    const text = (query || '').toLowerCase();
    if (!text) return false;
    return /(\bnomer\b|\bnomor\b|\bno\.?\b|\bkontak\b|\bcontact\b|\bhubungi\b|\btelepon\b|\btelp\b|\btlp\b|\bhp\b|\bwa\b|\bwhatsapp\b|\bhotline\b)/i.test(
      text
    );
  }

  private filterContactsByQuery(rows: DashboardImportantContactRow[], query: string): ImportantContact[] {
    const safeRows = Array.isArray(rows) ? rows : [];
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];

    const wantedCategories = this.inferWantedCategories(q);
    const genericRequest = this.isGenericContactRequest(q);

    // If user only asks "nomor/kontak" without specific entity, return all contacts.
    // This is DB-first behavior and lets the LLM present a clean menu.
    if (genericRequest && wantedCategories.length === 0) {
      return safeRows
        .map((r) => this.toImportantContact(r))
        .filter((c): c is ImportantContact => !!c);
    }

    const normalizedQuery = q.replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
    const tokens = normalizedQuery.split(' ').filter((t) => t.length >= 3);

    const scored: Array<{ score: number; contact: ImportantContact }> = [];

    for (const r of safeRows) {
      const contact = this.toImportantContact(r);
      if (!contact) continue;

      const category = (r.category_name || '').toString().toLowerCase();
      const haystack = `${contact.name} ${(contact.description || '')} ${category}`.toLowerCase();

      // Category filtering if user mentions a specific emergency institution.
      if (wantedCategories.length > 0 && category) {
        const categoryMatch = wantedCategories.includes(category as any);
        if (!categoryMatch) continue;
      }

      let score = 0;
      if (haystack.includes(normalizedQuery)) score += 10;
      for (const t of tokens) {
        if (haystack.includes(t)) score += 3;
      }
      if (wantedCategories.length > 0) score += 2;
      if (score > 0) scored.push({ score, contact });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.contact);
  }

  private extractContactsFromText(text: string): ImportantContact[] {
    const content = (text || '').trim();
    if (!content) return [];

    // Indonesian phone numbers: 08xxxxxxxxxx or 628xxxxxxxxxx (optionally with +62)
    const phoneRegex = /(?:\+?62|0)8\d{8,11}|\b62\d{9,14}\b/g;
    const matches = [...content.matchAll(phoneRegex)];
    if (matches.length === 0) return [];

    const results: ImportantContact[] = [];
    const seen = new Set<string>();

    for (const m of matches) {
      const rawPhone = m[0];
      const normalized = this.normalizePhoneNumber(rawPhone);
      if (!normalized || seen.has(normalized)) continue;

      const start = Math.max(0, (m.index ?? 0) - 80);
      const end = Math.min(content.length, (m.index ?? 0) + rawPhone.length + 80);
      const snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();

      // Try to infer a label before the number (e.g., "Polisi: 08...")
      const before = content.slice(Math.max(0, (m.index ?? 0) - 50), (m.index ?? 0));
      const labelMatch = before.match(/([A-Za-zÀ-ÿ0-9\s]{3,40})(?:[:\-–—]\s*)$/);
      const inferredName = labelMatch?.[1]?.trim() || 'Kontak';

      results.push({
        name: inferredName,
        phone: rawPhone,
        description: snippet,
        wa_link: normalized ? `https://wa.me/${normalized}` : '',
      });
      seen.add(normalized);
    }

    return results;
  }

  async getContacts(villageId: string, category?: string | null): Promise<ImportantContact[]> {
    if (!villageId) return [];

    try {
      const url = `${config.dashboardServiceUrl}/api/internal/important-contacts`;
      const response = await axios.get<DashboardImportantContactRow[]>(url, {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        params: {
          village_id: villageId,
          ...(category ? { category } : {}),
        },
        timeout: 10000,
      });

      const rows = Array.isArray(response.data) ? response.data : [];
      return rows
        .filter((r) => !!r && typeof r.name === 'string' && typeof r.phone === 'string')
        .map((r) => {
          const normalized = this.normalizePhoneNumber(r.phone);
          const waLink = normalized ? `https://wa.me/${normalized}` : '';
          return {
            name: r.name,
            phone: r.phone,
            description: r.description ?? null,
            wa_link: waLink,
          };
        });
    } catch (error: any) {
      logger.warn('Failed to fetch important contacts', {
        error: error.message,
        status: error.response?.status,
      });
      return [];
    }
  }

  /**
   * DB-first hybrid search:
   * 1) Fetch contacts from Dashboard DB and filter by user query
   * 2) If empty, fallback to Knowledge Base (RAG) and extract phone-like patterns
   */
  async findContactAndFallback(query: string, villageId: string): Promise<ImportantContactSearchResult> {
    const safeVillageId = villageId || '';
    const q = (query || '').trim();
    if (!safeVillageId || !q) return { source: 'DB', data: [] };

    // Priority 1: Database
    const rows = await this.fetchDashboardContacts(safeVillageId);
    const filtered = this.filterContactsByQuery(rows, q);
    if (filtered.length > 0) {
      return { source: 'DB', data: filtered };
    }

    // Priority 2: Knowledge Base (RAG)
    try {
      const rag = await retrieveContext(q, {
        topK: 5,
        minScore: 0.55,
        villageId: safeVillageId,
        sourceTypes: ['knowledge', 'document'],
      } as any);

      const kbText = typeof rag === 'string' ? rag : rag?.contextString || '';
      const kbContacts = this.extractContactsFromText(kbText);
      return { source: 'KB', data: kbContacts };
    } catch (error: any) {
      logger.warn('Failed to retrieve KB context for important contacts', {
        error: error.message,
      });
      return { source: 'KB', data: [] };
    }
  }
}

export const importantContactsService = new ImportantContactsService();
