/**
 * Agent Tool Executor — dispatches tool calls to existing service functions.
 *
 * Each tool function:
 * 1. Validates arguments
 * 2. Calls the underlying service
 * 3. Returns a structured JSON result string for the LLM
 *
 * Fase 2.1 + 2.4: Deterministic facts are served from DB, not RAG.
 */

import logger from '../../utils/logger';
import { getVillageProfileSummary } from '../knowledge.service';
import { getServiceCatalog, getComplaintTypes, getComplaintStatusWithOwnership, getServiceRequestStatusWithOwnership, createComplaint, cancelComplaint, cancelServiceRequest, updateComplaintByUser, getUserHistory, getServiceRequirements } from '../case-client.service';
import { getImportantContacts } from '../important-contacts.service';
import { searchKnowledge } from '../knowledge.service';
import type { AgentToolName } from './tool-definitions';

export interface ToolCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

interface ToolContext {
  /** WhatsApp user ID or webchat identifier */
  userId: string;
  /** Resolved village ID for multi-tenant scoping */
  villageId?: string;
  /** Channel type */
  channel: 'whatsapp' | 'webchat';
}

/**
 * Execute a tool call and return the result as a JSON string.
 * The agent orchestrator will feed this back into the LLM as a tool response.
 */
export async function executeToolCall(
  toolName: AgentToolName,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const startTime = Date.now();

  try {
    const result = await dispatchTool(toolName, args, ctx);
    const durationMs = Date.now() - startTime;

    logger.info('Agent tool executed', {
      tool: toolName,
      success: result.success,
      durationMs,
      userId: ctx.userId,
    });

    return JSON.stringify(result);
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    logger.error('Agent tool execution failed', {
      tool: toolName,
      error: error.message,
      durationMs,
      userId: ctx.userId,
    });

    return JSON.stringify({
      success: false,
      error: `Tool ${toolName} gagal: ${error.message}`,
    });
  }
}

async function dispatchTool(
  toolName: AgentToolName,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  switch (toolName) {
    case 'get_office_profile':
      return toolGetOfficeProfile(ctx);

    case 'get_service_catalog':
      return toolGetServiceCatalog(args, ctx);

    case 'get_complaint_categories':
      return toolGetComplaintCategories(ctx);

    case 'get_important_contacts':
      return toolGetImportantContacts(args, ctx);

    case 'search_knowledge':
      return toolSearchKnowledge(args, ctx);

    case 'check_complaint_status':
      return toolCheckComplaintStatus(args, ctx);

    case 'check_service_request_status':
      return toolCheckServiceRequestStatus(args, ctx);

    case 'create_complaint':
      return toolCreateComplaint(args, ctx);

    case 'create_service_request':
      return toolCreateServiceRequest(args, ctx);

    case 'cancel_complaint':
      return toolCancelComplaint(args, ctx);

    case 'cancel_service_request':
      return toolCancelServiceRequest(args, ctx);

    case 'update_complaint':
      return toolUpdateComplaint(args, ctx);

    case 'get_my_history':
      return toolGetMyHistory(ctx);

    case 'get_service_requirements':
      return toolGetServiceRequirements(args, ctx);

    default:
      return { success: false, error: `Tool tidak dikenal: ${toolName}` };
  }
}

// ─── Tool implementations ───

async function toolGetOfficeProfile(ctx: ToolContext): Promise<ToolCallResult> {
  const profile = await getVillageProfileSummary(ctx.villageId);
  if (!profile) {
    return { success: false, error: 'Profil kantor belum tersedia.' };
  }

  return {
    success: true,
    data: {
      name: profile.name || null,
      short_name: profile.short_name || null,
      address: profile.address || null,
      gmaps_url: profile.gmaps_url || null,
      operating_hours: profile.operating_hours || null,
    },
  };
}

async function toolGetServiceCatalog(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  const services = await getServiceCatalog(ctx.villageId);
  if (!services || services.length === 0) {
    return { success: true, data: { services: [], message: 'Belum ada layanan yang terdaftar.' } };
  }

  const keyword = typeof args.service_keyword === 'string' ? args.service_keyword.toLowerCase() : '';
  const filtered = keyword
    ? services.filter(
        (s: any) =>
          s.name?.toLowerCase().includes(keyword) ||
          s.slug?.toLowerCase().includes(keyword) ||
          s.description?.toLowerCase().includes(keyword),
      )
    : services;

  return {
    success: true,
    data: {
      services: filtered.map((s: any) => ({
        name: s.name,
        slug: s.slug,
        description: s.description || null,
        mode: s.mode || null,
        is_active: s.is_active,
      })),
      total: filtered.length,
    },
  };
}

async function toolGetComplaintCategories(ctx: ToolContext): Promise<ToolCallResult> {
  const types = await getComplaintTypes(ctx.villageId);
  if (!types || types.length === 0) {
    return { success: true, data: { categories: [], message: 'Belum ada kategori pengaduan.' } };
  }

  return {
    success: true,
    data: {
      categories: types.map((t: any) => ({
        name: t.name || t.kategori,
        slug: t.slug || t.kategori,
        description: t.description || null,
        is_urgent: t.is_urgent === true,
        require_address: t.require_address !== false,
        send_important_contacts: t.send_important_contacts === true,
      })),
      note: 'Kategori dengan is_urgent=true akan memicu notifikasi darurat ke petugas secara otomatis.',
    },
  };
}

async function toolGetImportantContacts(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  if (!ctx.villageId) {
    return { success: false, error: 'Village ID belum tersedia.' };
  }

  const category = typeof args.category === 'string' ? args.category : undefined;
  const contacts = await getImportantContacts(ctx.villageId, category);

  return {
    success: true,
    data: {
      contacts: contacts.map((c) => ({
        name: c.name,
        phone: c.phone,
        description: c.description || null,
        category: c.category?.name || null,
      })),
      total: contacts.length,
    },
  };
}

async function toolSearchKnowledge(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  const query = typeof args.query === 'string' ? args.query : '';
  if (!query.trim()) {
    return { success: false, error: 'Query pencarian tidak boleh kosong.' };
  }

  const categories = Array.isArray(args.categories)
    ? (args.categories as string[])
    : undefined;

  const result = await searchKnowledge(query, categories, ctx.villageId);

  if (!result.context || result.total === 0) {
    return {
      success: true,
      data: { found: false, context: '', message: 'Tidak ditemukan informasi yang relevan.' },
    };
  }

  return {
    success: true,
    data: {
      found: true,
      context: result.context,
      total: result.total,
    },
  };
}

async function toolCheckComplaintStatus(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  const complaintId = typeof args.complaint_id === 'string' ? args.complaint_id : '';
  if (!complaintId) {
    return { success: false, error: 'Nomor laporan harus diisi.' };
  }

  const result = await getComplaintStatusWithOwnership(complaintId, {
    wa_user_id: ctx.channel === 'whatsapp' ? ctx.userId : undefined,
    channel: ctx.channel === 'whatsapp' ? 'WHATSAPP' : 'WEBCHAT',
    channel_identifier: ctx.channel === 'webchat' ? ctx.userId : undefined,
  });

  if (!result.success) {
    return { success: false, error: result.message || 'Laporan tidak ditemukan.' };
  }

  return { success: true, data: result.data };
}

async function toolCheckServiceRequestStatus(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  const requestNumber = typeof args.request_number === 'string' ? args.request_number : '';
  if (!requestNumber) {
    return { success: false, error: 'Nomor permohonan harus diisi.' };
  }

  const result = await getServiceRequestStatusWithOwnership(requestNumber, {
    wa_user_id: ctx.channel === 'whatsapp' ? ctx.userId : undefined,
    channel: ctx.channel === 'whatsapp' ? 'WHATSAPP' : 'WEBCHAT',
    channel_identifier: ctx.channel === 'webchat' ? ctx.userId : undefined,
  });

  if (!result.success) {
    return { success: false, error: result.message || 'Permohonan tidak ditemukan.' };
  }

  return { success: true, data: result.data };
}

async function toolCreateComplaint(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  const kategori = typeof args.kategori === 'string' ? args.kategori : '';
  const deskripsi = typeof args.deskripsi === 'string' ? args.deskripsi : '';
  const alamat = typeof args.alamat === 'string' ? args.alamat : '';
  const rt_rw = typeof args.rt_rw === 'string' ? args.rt_rw : undefined;

  if (!kategori || !deskripsi || !alamat) {
    return { success: false, error: 'Kategori, deskripsi, dan alamat harus diisi lengkap.' };
  }

  // Lookup complaint type config to determine urgency and contact notification flags.
  // This mirrors the old pipeline behavior: is_urgent is DB-driven, not user-set.
  let isUrgent = false;
  let sendImportantContacts = false;
  try {
    const types = await getComplaintTypes(ctx.villageId);
    const typeConfig = types.find(
      (t) => (t.name || '').toLowerCase() === kategori.toLowerCase() ||
             (t.category?.name || '').toLowerCase() === kategori.toLowerCase(),
    );
    if (typeConfig) {
      isUrgent = typeConfig.is_urgent === true;
      sendImportantContacts = typeConfig.send_important_contacts === true;
    }
  } catch {
    // Non-critical — fall through without urgency flag
  }

  const complaintId = await createComplaint({
    wa_user_id: ctx.channel === 'whatsapp' ? ctx.userId : undefined,
    channel: ctx.channel === 'whatsapp' ? 'WHATSAPP' : 'WEBCHAT',
    channel_identifier: ctx.channel === 'webchat' ? ctx.userId : undefined,
    kategori,
    deskripsi,
    alamat,
    rt_rw,
    village_id: ctx.villageId,
    is_urgent: isUrgent,
  });

  if (!complaintId) {
    return { success: false, error: 'Gagal membuat laporan. Silakan coba lagi.' };
  }

  return {
    success: true,
    data: {
      complaint_id: complaintId,
      status: 'baru',
      is_urgent: isUrgent,
      send_important_contacts: sendImportantContacts,
      message: isUrgent
        ? `Laporan DARURAT berhasil dibuat dengan nomor ${complaintId}. Petugas akan segera dihubungi.`
        : `Laporan berhasil dibuat dengan nomor ${complaintId}.`,
    },
  };
}

async function toolCreateServiceRequest(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  const serviceSlug = typeof args.service_slug === 'string' ? args.service_slug : '';
  const citizenData = typeof args.citizen_data === 'object' && args.citizen_data !== null
    ? args.citizen_data as Record<string, string>
    : {};

  if (!serviceSlug) {
    return { success: false, error: 'Slug layanan harus diisi.' };
  }

  if (!citizenData.nama_lengkap) {
    return { success: false, error: 'Nama lengkap pemohon harus diisi.' };
  }

  // Service request creation is done via the form URL flow, not direct API
  // Return the information needed for the user to complete the request
  return {
    success: true,
    data: {
      service_slug: serviceSlug,
      citizen_data: citizenData,
      message: `Permohonan layanan ${serviceSlug} akan diproses. Data pemohon: ${citizenData.nama_lengkap}.`,
      next_step: 'Sistem akan mengarahkan ke formulir online untuk melengkapi permohonan.',
    },
  };
}

async function toolCancelComplaint(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  const complaintId = typeof args.complaint_id === 'string' ? args.complaint_id : '';
  if (!complaintId) {
    return { success: false, error: 'Nomor laporan harus diisi.' };
  }

  const cancelReason = typeof args.cancel_reason === 'string' ? args.cancel_reason : undefined;

  const result = await cancelComplaint(complaintId, {
    wa_user_id: ctx.channel === 'whatsapp' ? ctx.userId : undefined,
    channel: ctx.channel === 'whatsapp' ? 'WHATSAPP' : 'WEBCHAT',
    channel_identifier: ctx.channel === 'webchat' ? ctx.userId : undefined,
  }, cancelReason);

  if (!result.success) {
    return { success: false, error: result.message || 'Gagal membatalkan laporan.' };
  }

  return {
    success: true,
    data: {
      complaint_id: complaintId,
      message: result.message || 'Laporan berhasil dibatalkan.',
    },
  };
}

async function toolCancelServiceRequest(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  const requestNumber = typeof args.request_number === 'string' ? args.request_number : '';
  if (!requestNumber) {
    return { success: false, error: 'Nomor permohonan harus diisi.' };
  }

  const cancelReason = typeof args.cancel_reason === 'string' ? args.cancel_reason : undefined;

  const result = await cancelServiceRequest(requestNumber, {
    wa_user_id: ctx.channel === 'whatsapp' ? ctx.userId : undefined,
    channel: ctx.channel === 'whatsapp' ? 'WHATSAPP' : 'WEBCHAT',
    channel_identifier: ctx.channel === 'webchat' ? ctx.userId : undefined,
  }, cancelReason);

  if (!result.success) {
    return { success: false, error: result.message || 'Gagal membatalkan permohonan.' };
  }

  return {
    success: true,
    data: {
      request_number: requestNumber,
      message: result.message || 'Permohonan layanan berhasil dibatalkan.',
    },
  };
}

async function toolUpdateComplaint(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  const complaintId = typeof args.complaint_id === 'string' ? args.complaint_id : '';
  if (!complaintId) {
    return { success: false, error: 'Nomor laporan harus diisi.' };
  }

  const updateData: { alamat?: string; deskripsi?: string; rt_rw?: string } = {};
  if (typeof args.alamat === 'string') updateData.alamat = args.alamat;
  if (typeof args.deskripsi === 'string') updateData.deskripsi = args.deskripsi;
  if (typeof args.rt_rw === 'string') updateData.rt_rw = args.rt_rw;

  if (Object.keys(updateData).length === 0) {
    return { success: false, error: 'Minimal satu field (alamat, deskripsi, atau rt_rw) harus diisi.' };
  }

  const result = await updateComplaintByUser(complaintId, {
    wa_user_id: ctx.channel === 'whatsapp' ? ctx.userId : undefined,
    channel: ctx.channel === 'whatsapp' ? 'WHATSAPP' : 'WEBCHAT',
    channel_identifier: ctx.channel === 'webchat' ? ctx.userId : undefined,
  }, updateData);

  if (!result.success) {
    return { success: false, error: result.message || 'Gagal memperbarui laporan.' };
  }

  return {
    success: true,
    data: {
      complaint_id: complaintId,
      message: result.message || 'Laporan berhasil diperbarui.',
      updated_fields: Object.keys(updateData),
    },
  };
}

async function toolGetMyHistory(ctx: ToolContext): Promise<ToolCallResult> {
  const result = await getUserHistory({
    wa_user_id: ctx.channel === 'whatsapp' ? ctx.userId : undefined,
    channel: ctx.channel === 'whatsapp' ? 'WHATSAPP' : 'WEBCHAT',
    channel_identifier: ctx.channel === 'webchat' ? ctx.userId : undefined,
  });

  if (!result) {
    return { success: true, data: { complaints: [], service_requests: [], total: 0, message: 'Belum ada riwayat.' } };
  }

  return {
    success: true,
    data: result,
  };
}

async function toolGetServiceRequirements(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  const serviceSlug = typeof args.service_slug === 'string' ? args.service_slug : '';
  if (!serviceSlug) {
    return { success: false, error: 'Slug layanan harus diisi. Gunakan get_service_catalog untuk mendapatkan daftar layanan.' };
  }

  // First get the catalog to find the service ID from the slug
  const catalog = await getServiceCatalog(ctx.villageId);
  const service = catalog?.find((s: any) => s.slug === serviceSlug || s.name?.toLowerCase() === serviceSlug.toLowerCase());

  if (!service) {
    return { success: false, error: `Layanan "${serviceSlug}" tidak ditemukan.` };
  }

  const requirements = await getServiceRequirements(service.id || service.slug);

  return {
    success: true,
    data: {
      service_name: service.name,
      service_slug: service.slug,
      requirements: requirements.map((r: any) => ({
        field: r.field_name || r.name,
        label: r.label || r.field_name,
        type: r.field_type || r.type,
        required: r.is_required ?? r.required ?? false,
        description: r.description || null,
      })),
      total: requirements.length,
    },
  };
}
