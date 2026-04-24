import axios from 'axios';
import { config } from '../config/env';
import logger from '../utils/logger';

export interface VillageBehaviorConfig {
  active_service_ids?: string[];
  important_contacts?: string[];
  service_hours?: Record<string, unknown>;
  local_faq_priority?: string[];
  escalation_routing?: Record<string, unknown>;
  complaint_rules?: string[];
  service_rules?: string[];
  notice?: string;
}

const cache = new Map<string, { value: VillageBehaviorConfig | null; ts: number }>();
const TTL_MS = 10 * 60 * 1000;

export async function getVillageBehaviorConfig(villageId?: string): Promise<VillageBehaviorConfig | null> {
  if (!villageId) return null;

  const cached = cache.get(villageId);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.value;

  try {
    const response = await axios.get<{ data?: { config?: VillageBehaviorConfig } }>(
      `${config.dashboardServiceUrl}/api/internal/village-behavior`,
      {
        params: { village_id: villageId },
        headers: { 'x-internal-api-key': config.internalApiKey },
        timeout: 5000,
      },
    );
    const value = response.data.data?.config || null;
    cache.set(villageId, { value, ts: Date.now() });
    return value;
  } catch (error: any) {
    logger.warn('Failed to fetch village behavior config', { villageId, error: error.message });
    cache.set(villageId, { value: null, ts: Date.now() });
    return null;
  }
}

export function formatVillageBehaviorConfig(behavior: VillageBehaviorConfig | null): string {
  if (!behavior) return '';

  const lines: string[] = ['KONFIGURASI PERILAKU DESA:'];
  if (behavior.notice) lines.push(`- Catatan: ${behavior.notice}`);
  if (behavior.active_service_ids?.length) lines.push(`- Layanan aktif prioritas: ${behavior.active_service_ids.join(', ')}`);
  if (behavior.local_faq_priority?.length) lines.push(`- FAQ lokal prioritas: ${behavior.local_faq_priority.join('; ')}`);
  if (behavior.important_contacts?.length) lines.push(`- Kontak penting prioritas: ${behavior.important_contacts.join(', ')}`);
  if (behavior.complaint_rules?.length) lines.push(`- Aturan pengaduan lokal: ${behavior.complaint_rules.join('; ')}`);
  if (behavior.service_rules?.length) lines.push(`- Aturan layanan lokal: ${behavior.service_rules.join('; ')}`);
  if (behavior.service_hours && Object.keys(behavior.service_hours).length) lines.push(`- Jam layanan lokal: ${JSON.stringify(behavior.service_hours)}`);
  if (behavior.escalation_routing && Object.keys(behavior.escalation_routing).length) lines.push(`- Routing eskalasi lokal: ${JSON.stringify(behavior.escalation_routing)}`);

  return lines.length > 1 ? lines.join('\n') : '';
}

export function clearVillageBehaviorCache(): number {
  const count = cache.size;
  cache.clear();
  return count;
}
