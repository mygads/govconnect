import logger from '../utils/logger';
import { getImportantContacts } from './important-contacts.service';
import {
  getServiceCatalog,
  getServiceRequirements,
  type ServiceCatalogItem,
} from './case-client.service';
import { getVillageProfileSummary } from './knowledge.service';
import { matchContactQuery } from './micro-llm-matcher.service';
import { resolveServiceSlugFromSearch } from './service-handler';
import {
  formatClickableLink,
  formatClickablePhone,
  type ChannelType,
} from './ump-formatters';

const OFFICE_TERMS = /\b(kantor|kelurahan|desa|balai|pemdes|pelayanan)\b/;
const ADDRESS_TERMS = /\b(alamat|lokasi|letak|maps|gmaps|peta|dimana|di mana)\b/;
const HOURS_TERMS = /\b(jam|buka|tutup|operasional|kerja|hari kerja|sabtu|minggu)\b/;
const CONTACT_TERMS = /\b(kontak|nomor|telepon|telp|wa|whatsapp|hotline|darurat|ambulans|ambulan|damkar|pemadam|polisi|puskesmas|rumah sakit|rs|bidan)\b/;
const SERVICE_CATALOG_TERMS = /\b(layanan apa|layanan apa saja|layanan apa aja|apa saja layanan|apa aja layanan|daftar layanan|jenis layanan|layanan tersedia|layanan online|surat apa saja)\b/;
const REQUIREMENT_TERMS = /\b(syarat|persyaratan|dokumen|berkas|formulir)\b/;
const SERVICE_HINT_TERMS = /\b(ktp|kk|skck|sktm|domisili|usaha|nikah|pindah|lahir|kelahiran|kematian|akta|surat|bpjs|umkm|bantuan)\b/;

export interface DeterministicFactReplyInput {
  userId: string;
  villageId?: string;
  message: string;
  channel: ChannelType;
}

export interface DeterministicFactReplyResult {
  response: string;
  intent: 'KNOWLEDGE_QUERY' | 'SERVICE_INFO';
  source: 'office_profile' | 'important_contacts' | 'service_catalog' | 'service_requirements';
}

export async function resolveDeterministicFactReply(
  input: DeterministicFactReplyInput,
): Promise<DeterministicFactReplyResult | null> {
  const normalized = normalizeMessage(input.message);
  if (!normalized) return null;

  if (isOfficeProfileQuery(normalized)) {
    const response = await buildOfficeProfileReply(normalized, input.channel, input.villageId);
    if (response) {
      return {
        response,
        intent: 'KNOWLEDGE_QUERY',
        source: 'office_profile',
      };
    }
  }

  if (isContactQuery(normalized)) {
    const response = await buildImportantContactsReply(input, normalized);
    if (response) {
      return {
        response,
        intent: 'KNOWLEDGE_QUERY',
        source: 'important_contacts',
      };
    }
  }

  if (isServiceRequirementQuery(normalized)) {
    const response = await buildServiceRequirementReply(input, normalized);
    if (response) {
      return {
        response,
        intent: 'SERVICE_INFO',
        source: 'service_requirements',
      };
    }
  }

  if (isServiceCatalogQuery(normalized)) {
    const response = await buildServiceCatalogReply(normalized, input.villageId);
    if (response) {
      return {
        response,
        intent: 'SERVICE_INFO',
        source: 'service_catalog',
      };
    }
  }

  return null;
}

function normalizeMessage(message: string): string {
  return (message || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isOfficeProfileQuery(message: string): boolean {
  const wantsAddress = ADDRESS_TERMS.test(message) && (OFFICE_TERMS.test(message) || message.includes('kantornya'));
  const wantsHours = HOURS_TERMS.test(message) && (OFFICE_TERMS.test(message) || /\b(buka|tutup|sabtu|minggu)\b/.test(message));
  return wantsAddress || wantsHours;
}

function isContactQuery(message: string): boolean {
  return CONTACT_TERMS.test(message);
}

function isServiceRequirementQuery(message: string): boolean {
  return REQUIREMENT_TERMS.test(message) && SERVICE_HINT_TERMS.test(message);
}

function isServiceCatalogQuery(message: string): boolean {
  if (SERVICE_CATALOG_TERMS.test(message)) return true;

  const words = message.split(' ').filter(Boolean);
  return words.length <= 3 && words.some((word) => SERVICE_HINT_TERMS.test(word));
}

async function buildOfficeProfileReply(
  normalizedMessage: string,
  channel: ChannelType,
  villageId?: string,
): Promise<string | null> {
  const profile = await getVillageProfileSummary(villageId);
  if (!profile) return null;

  const wantsAddress = ADDRESS_TERMS.test(normalizedMessage);
  const wantsHours = HOURS_TERMS.test(normalizedMessage);
  const lines = ['Berdasarkan data resmi kantor desa/kelurahan:'];

  if (wantsAddress && (profile.address || profile.gmaps_url)) {
    if (profile.address) {
      lines.push(`- Alamat kantor: ${profile.address}`);
    }
    if (profile.gmaps_url) {
      lines.push(`- Google Maps: ${formatClickableLink(profile.gmaps_url, channel, 'Lokasi kantor')}`);
    }
  }

  if (wantsHours && profile.operating_hours) {
    lines.push(`- Jam operasional: ${formatOperatingHours(profile.operating_hours)}`);
  }

  if (lines.length === 1) {
    return null;
  }

  return lines.join('\n');
}

async function buildImportantContactsReply(
  input: DeterministicFactReplyInput,
  normalizedMessage: string,
): Promise<string | null> {
  if (!input.villageId) return null;

  const contacts = await getImportantContacts(input.villageId);
  if (!contacts.length) return null;

  let relevantContacts = contacts;
  const match = await matchContactQuery(
    input.message,
    contacts.map((contact) => ({
      name: contact.name,
      description: contact.description || undefined,
      category: contact.category?.name || undefined,
    })),
    {
      village_id: input.villageId,
      wa_user_id: input.userId,
      session_id: input.userId,
      channel: input.channel,
    },
  ).catch((error: any) => {
    logger.warn('Deterministic contact match failed, falling back to heuristic', {
      error: error.message,
      villageId: input.villageId,
    });
    return null;
  });

  if (match?.matched_indices?.length) {
    relevantContacts = match.matched_indices
      .map((index) => contacts[index])
      .filter(Boolean);
  } else {
    relevantContacts = filterContactsHeuristically(contacts, normalizedMessage);
  }

  if (!relevantContacts.length) {
    relevantContacts = contacts.slice(0, 5);
  }

  const lines = relevantContacts.slice(0, 5).map((contact) => {
    const phone = formatClickablePhone(contact.phone, input.channel);
    const desc = contact.description ? ` (${contact.description})` : '';
    return `- ${contact.name}: ${phone}${desc}`;
  });

  return [
    'Berdasarkan daftar kontak penting desa:',
    ...lines,
  ].join('\n');
}

function filterContactsHeuristically(
  contacts: Awaited<ReturnType<typeof getImportantContacts>>,
  normalizedMessage: string,
) {
  const keywordSets = [
    {
      test: /\b(darurat|ambulans|ambulan|igd|rs|rumah sakit|puskesmas|bidan)\b/,
      matches: ['darurat', 'ambulans', 'ambulan', 'rumah sakit', 'rs', 'puskesmas', 'bidan', 'kesehatan'],
    },
    {
      test: /\b(damkar|pemadam|kebakaran)\b/,
      matches: ['damkar', 'pemadam', 'kebakaran'],
    },
    {
      test: /\b(polisi|keamanan)\b/,
      matches: ['polisi', 'keamanan'],
    },
  ];

  for (const set of keywordSets) {
    if (!set.test.test(normalizedMessage)) continue;

    const filtered = contacts.filter((contact) => {
      const haystack = `${contact.name} ${contact.description || ''} ${contact.category?.name || ''}`.toLowerCase();
      return set.matches.some((keyword) => haystack.includes(keyword));
    });

    if (filtered.length) return filtered;
  }

  return contacts;
}

async function buildServiceRequirementReply(
  input: DeterministicFactReplyInput,
  normalizedMessage: string,
): Promise<string | null> {
  const resolved = await resolveServiceSlugFromSearch(input.message, input.villageId);
  if (!resolved) return null;

  if (resolved.alternatives?.length) {
    const options = resolved.alternatives
      .slice(0, 5)
      .map((item, index) => `${index + 1}. ${item.name}`)
      .join('\n');

    return [
      'Ada beberapa layanan yang mirip dengan pertanyaan Bapak/Ibu:',
      options,
      '',
      'Silakan sebutkan nama layanan yang dimaksud agar saya bisa tampilkan persyaratannya.',
    ].join('\n');
  }

  const services = await getServiceCatalog(input.villageId);
  const service = services.find((item) => item.slug === resolved.slug);
  if (!service) return null;
  if (service.is_active === false) {
    return `Layanan *${service.name}* saat ini belum aktif di katalog desa.`;
  }

  const requirements = Array.isArray(service.requirements) && service.requirements.length > 0
    ? service.requirements
    : await getServiceRequirements(service.id || service.slug);

  const modeText = getServiceModeText(service.mode);
  const lines = [`Berdasarkan katalog layanan desa, untuk *${service.name}*:`];

  if (requirements.length > 0) {
    for (const [index, requirement] of requirements.entries()) {
      const suffix = requirement.is_required ? ' (wajib)' : ' (opsional)';
      const helpText = requirement.help_text ? ` - ${requirement.help_text}` : '';
      lines.push(`${index + 1}. ${requirement.label}${suffix}${helpText}`);
    }
  } else if (service.description) {
    lines.push(service.description);
    lines.push('Persyaratan rinci belum terdaftar sebagai field terstruktur di sistem.');
  } else {
    lines.push('Persyaratan rinci belum tersedia di sistem untuk layanan ini.');
  }

  if (modeText) {
    lines.push('');
    lines.push(modeText);
  }

  return lines.join('\n');
}

async function buildServiceCatalogReply(
  normalizedMessage: string,
  villageId?: string,
): Promise<string | null> {
  const services = (await getServiceCatalog(villageId)).filter((service) => service.is_active);
  if (!services.length) {
    return 'Belum ada layanan aktif yang terdaftar di katalog desa saat ini.';
  }

  const filteredServices = filterServicesByQuery(services, normalizedMessage);
  const servicesToShow = filteredServices.length > 0 ? filteredServices : services;

  const lines = servicesToShow
    .slice(0, 8)
    .map((service) => {
      const category = service.category?.name ? ` [${service.category.name}]` : '';
      const mode = getServiceModeBadge(service.mode);
      return `- ${service.name}${category}${mode}`;
    });

  const intro = filteredServices.length > 0 && filteredServices.length < services.length
    ? 'Berdasarkan katalog layanan desa, layanan yang paling relevan adalah:'
    : 'Berdasarkan katalog layanan desa, beberapa layanan aktif yang tersedia adalah:';

  return [
    intro,
    ...lines,
    '',
    'Jika Bapak/Ibu ingin tahu syarat salah satu layanan, sebutkan nama layanannya.',
  ].join('\n');
}

function filterServicesByQuery(services: ServiceCatalogItem[], normalizedMessage: string): ServiceCatalogItem[] {
  const searchTerms = normalizedMessage
    .split(' ')
    .filter((term) => term.length > 2)
    .filter((term) => !['layanan', 'surat', 'syarat', 'dokumen', 'berkas', 'formulir', 'apa', 'saja'].includes(term));

  if (!searchTerms.length) return [];

  return services.filter((service) => {
    const haystack = [
      service.name,
      service.slug,
      service.description || '',
      service.category?.name || '',
    ]
      .join(' ')
      .toLowerCase();

    return searchTerms.some((term) => haystack.includes(term));
  });
}

function formatOperatingHours(value: unknown): string {
  if (!value) return 'Belum tersedia';
  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    const rendered = value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') return JSON.stringify(item);
        return '';
      })
      .filter(Boolean);
    return rendered.length ? rendered.join('; ') : 'Belum tersedia';
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, hours]) => {
        if (typeof hours === 'string') return `${capitalizeWord(key)} ${hours}`;
        if (!hours || typeof hours !== 'object') return `${capitalizeWord(key)} belum diatur`;

        const open = typeof (hours as Record<string, unknown>).open === 'string'
          ? String((hours as Record<string, unknown>).open)
          : '';
        const close = typeof (hours as Record<string, unknown>).close === 'string'
          ? String((hours as Record<string, unknown>).close)
          : '';

        if (open === '-' || close === '-') return `${capitalizeWord(key)} libur`;
        if (!open && !close) return `${capitalizeWord(key)} belum diatur`;

        return `${capitalizeWord(key)} ${open || '-'}-${close || '-'}`;
      });

    return entries.join('; ');
  }

  return 'Belum tersedia';
}

function getServiceModeText(mode?: string | null): string {
  if (mode === 'online') {
    return 'Layanan ini bisa diajukan secara online.';
  }
  if (mode === 'both') {
    return 'Layanan ini bisa diajukan online maupun datang langsung ke kantor.';
  }
  if (mode === 'offline') {
    return 'Layanan ini diproses secara offline di kantor desa/kelurahan.';
  }
  return '';
}

function getServiceModeBadge(mode?: string | null): string {
  if (mode === 'online') return ' [online]';
  if (mode === 'both') return ' [hybrid]';
  if (mode === 'offline') return ' [offline]';
  return '';
}

function capitalizeWord(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
