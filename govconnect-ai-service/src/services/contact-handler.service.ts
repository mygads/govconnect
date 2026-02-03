/**
 * Contact Handler Service
 * 
 * Handles contact queries using NLU output
 * Maps NLU category_match to database contacts
 */

import logger from '../utils/logger';
import { NLUOutput } from './nlu-llm.service';
import { getImportantContacts, ImportantContact } from './important-contacts.service';
import { searchKnowledge } from './knowledge.service';
import { ChannelType } from './unified-message-processor.service';

export interface ContactHandlerResult {
  found: boolean;
  response: string;
  contacts?: Array<{
    name: string;
    phone: string;
    category: string;
    description?: string;
  }>;
}

/**
 * Format phone number as clickable for webchat
 */
function formatPhoneClickable(phone: string, channel: ChannelType): string {
  if (channel !== 'webchat') {
    return phone;
  }
  // Clean up phone for tel: link
  const cleanPhone = phone.replace(/[\s-]/g, '');
  return `<a href="tel:${cleanPhone}" target="_blank" style="color: #2563eb; text-decoration: underline;">${phone}</a>`;
}

/**
 * Handle contact query based on NLU output
 * Supports both old contact_request format and new info_request format
 */
export async function handleContactQuery(
  nluOutput: any, // Accept any NLU format for backward compatibility
  villageId: string,
  villageName: string,
  channel: ChannelType = 'whatsapp',
): Promise<ContactHandlerResult> {
  // Support both old and new NLU formats
  const contactRequest = nluOutput.contact_request || nluOutput.info_request;
  
  if (!contactRequest) {
    logger.warn('handleContactQuery called without contact_request or info_request');
    return {
      found: false,
      response: 'Mohon maaf, saya tidak yakin kontak apa yang Kakak butuhkan. Bisa diperjelas?',
    };
  }

  // Normalize field names (old: category_match/category_keyword, new: topic/keywords)
  const category_match = contactRequest.category_match || contactRequest.topic;
  const category_keyword = contactRequest.category_keyword || (contactRequest.keywords && contactRequest.keywords[0]);
  const is_emergency = contactRequest.is_emergency;

  logger.info('🔍 Handling contact query', {
    villageId,
    category_keyword,
    category_match,
    is_emergency,
  });

  // Get contacts - filter by category if matched
  let contacts: ImportantContact[] = await getImportantContacts(villageId, category_match || undefined);

  // If no match with category filter, get all and try multiple fallback strategies
  if ((!contacts || contacts.length === 0) && (category_match || category_keyword)) {
    const allContacts = await getImportantContacts(villageId);
    
    if (allContacts?.length) {
      const searchTerms = [category_match, category_keyword].filter(Boolean).map(s => s!.toLowerCase());
      
      // Strategy 1: Filter by category name (case-insensitive, partial match)
      contacts = allContacts.filter((c: ImportantContact) => 
        searchTerms.some(term => 
          c.category?.name?.toLowerCase().includes(term) ||
          term.includes(c.category?.name?.toLowerCase() || '')
        )
      );
      
      // Strategy 2: If still no match, search in contact name and description
      if (contacts.length === 0) {
        contacts = allContacts.filter((c: ImportantContact) => 
          searchTerms.some(term => 
            c.name?.toLowerCase().includes(term) ||
            c.description?.toLowerCase()?.includes(term)
          )
        );
      }
    }
  }

  // If still no contacts, try keyword-based search in KB
  let kbContacts: string[] = [];
  if ((!contacts || contacts.length === 0) && category_keyword) {
    const knowledgeResult = await searchKnowledge(
      `nomor ${category_keyword}`,
      ['Profil Desa', 'Kontak', 'Informasi'],
      villageId
    );
    
    if (knowledgeResult?.context) {
      // Extract phone numbers from KB
      const phoneMatches = knowledgeResult.context.match(/(\+?62|0)\s*\d[\d\s-]{7,14}\d/g) || [];
      kbContacts = Array.from(new Set(phoneMatches.map(normalizePhone).filter(Boolean)));
    }
  }

  // Build response
  if ((!contacts || contacts.length === 0) && kbContacts.length === 0) {
    const keywordHint = category_keyword ? ` untuk ${category_keyword}` : '';
    return {
      found: false,
      response: `Mohon maaf Kak, informasi nomor${keywordHint} di ${villageName} belum tersedia. Silakan hubungi kantor desa langsung.`,
    };
  }

  const lines: string[] = [];
  const resultContacts: ContactHandlerResult['contacts'] = [];

  if (contacts && contacts.length > 0) {
    // Use emergency flag to prioritize if needed
    const sorted = is_emergency 
      ? contacts.sort((a: ImportantContact, b: ImportantContact) => {
          const aEmergency = /darurat|emergency|urgent/i.test(a.name || '');
          const bEmergency = /darurat|emergency|urgent/i.test(b.name || '');
          return Number(bEmergency) - Number(aEmergency);
        })
      : contacts;

    const categoryLabel = category_match || category_keyword || 'Penting';
    lines.push(`Nomor ${categoryLabel} di ${villageName}:`);

    for (const c of sorted.slice(0, 5)) {
      const desc = c.description ? ` — ${c.description}` : '';
      const phoneDisplay = formatPhoneClickable(c.phone || '', channel);
      lines.push(`📞 ${c.name}: ${phoneDisplay}${desc}`);
      resultContacts.push({
        name: c.name || '',
        phone: c.phone || '',
        category: c.category?.name || '',
        description: c.description || undefined,
      });
    }
  }

  // Add KB contacts if any
  if (kbContacts.length > 0) {
    if (lines.length > 0) {
      lines.push('\nNomor tambahan:');
    } else {
      lines.push(`Nomor ${category_keyword || 'penting'} di ${villageName}:`);
    }
    
    for (const phone of kbContacts.slice(0, 3)) {
      const phoneDisplay = formatPhoneClickable(phone, channel);
      lines.push(`📞 ${phoneDisplay}`);
    }
  }

  // Add emergency note if urgent
  if (is_emergency) {
    lines.push('\n⚠️ Jika darurat, segera hubungi nomor di atas atau 112.');
  }

  return {
    found: true,
    response: lines.join('\n'),
    contacts: resultContacts,
  };
}

function normalizePhone(phone: string): string {
  if (!phone) return '';
  // Remove spaces and dashes, keep +
  return phone.replace(/[\s-]/g, '').trim();
}

/**
 * Map common Indonesian keywords to contact categories
 * This is used as fallback when LLM doesn't provide category_match
 * 
 * NOTE: Category names must match actual database category names exactly (case-insensitive)
 * Common categories in database: Puskesmas, Damkar, Polisi, Dinas, etc.
 */
export function mapKeywordToCategory(keyword: string): string | null {
  const normalized = keyword.toLowerCase().trim();
  
  // Map keywords to actual database category names
  // Each entry maps to the EXACT category name in database (case-insensitive match is used by API)
  const mappings: Record<string, string[]> = {
    // Health-related contacts - maps to actual category "Puskesmas"
    'Puskesmas': ['ambulan', 'ambulans', 'rs', 'rumah sakit', 'puskesmas', 'dokter', 'klinik', 'kesehatan', 'medis', 'ugd', 'bidan', 'posyandu'],
    // Fire department - maps to actual category "Damkar"
    'Damkar': ['pemadam', 'damkar', 'kebakaran', 'api', 'fire'],
    // Police/security - maps to actual category "Polisi" or "Keamanan"
    'Polisi': ['polisi', 'polres', 'polsek', 'kepolisian'],
    'Keamanan': ['keamanan', 'babinsa', 'koramil', 'tni', 'linmas', 'satpol', 'security'],
    // Government offices
    'Dinas': ['dinas', 'kantor', 'kecamatan', 'kelurahan'],
    // Emergency general
    'Darurat': ['darurat', 'emergency', 'urgent', '112', '119', '110'],
    // Complaints
    'Pengaduan': ['pengaduan', 'aduan', 'lapor', 'komplain'],
    // Services
    'Pelayanan': ['pelayanan', 'layanan', 'service', 'administrasi'],
  };

  for (const [category, keywords] of Object.entries(mappings)) {
    if (keywords.some(k => normalized.includes(k))) {
      return category;
    }
  }

  // Return the keyword itself as a fallback - let the database do case-insensitive matching
  // This handles cases like user typing exact category name
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
