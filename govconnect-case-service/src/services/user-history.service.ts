import prisma from '../config/database';
import logger from '../utils/logger';

export interface HistoryItem {
  type: 'complaint' | 'reservation' | 'ticket';
  id: string;
  display_id: string;
  description: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface UserHistoryResult {
  complaints: any[];
  reservations: any[];
  /** @deprecated Use reservations instead. Kept for backward compatibility with old data */
  tickets: any[];
  combined: HistoryItem[];
  total: number;
}

/**
 * Get user's complaint and reservation history
 * Note: tickets are legacy and only shown if user has old ticket data
 */
export async function getUserHistory(wa_user_id: string): Promise<UserHistoryResult> {
  try {
    // Fetch complaints, reservations, and legacy tickets in parallel
    const [complaints, reservations, tickets] = await Promise.all([
      // Complaints
      prisma.complaint.findMany({
        where: { wa_user_id },
        orderBy: { created_at: 'desc' },
        take: 20,
        select: {
          id: true,
          complaint_id: true,
          kategori: true,
          deskripsi: true,
          alamat: true,
          status: true,
          created_at: true,
          updated_at: true,
        },
      }),
      // Reservations (new system)
      prisma.reservation.findMany({
        where: { wa_user_id },
        orderBy: { created_at: 'desc' },
        take: 20,
        select: {
          id: true,
          reservation_id: true,
          service_code: true,
          reservation_date: true,
          reservation_time: true,
          queue_number: true,
          status: true,
          created_at: true,
          updated_at: true,
          service: {
            select: {
              name: true,
            },
          },
        },
      }),
      // Legacy tickets (only fetch if needed for backward compatibility)
      prisma.ticket.findMany({
        where: { wa_user_id },
        orderBy: { created_at: 'desc' },
        take: 10, // Limit legacy tickets
        select: {
          id: true,
          ticket_id: true,
          jenis: true,
          data_json: true,
          status: true,
          created_at: true,
          updated_at: true,
        },
      }),
    ]);

    // Combine and sort by date
    const combined: HistoryItem[] = [
      // Complaints
      ...complaints.map((c) => ({
        type: 'complaint' as const,
        id: c.id,
        display_id: c.complaint_id,
        description: c.deskripsi || getKategoriLabel(c.kategori),
        status: c.status,
        created_at: c.created_at,
        updated_at: c.updated_at,
      })),
      // Reservations
      ...reservations.map((r) => ({
        type: 'reservation' as const,
        id: r.id,
        display_id: r.reservation_id,
        description: getReservationDescription(r),
        status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
      // Legacy tickets (only if any exist)
      ...tickets.map((t) => ({
        type: 'ticket' as const,
        id: t.id,
        display_id: t.ticket_id,
        description: getTicketDescription(t.jenis, t.data_json),
        status: t.status,
        created_at: t.created_at,
        updated_at: t.updated_at,
      })),
    ].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

    logger.info('User history fetched', {
      wa_user_id,
      complaints: complaints.length,
      reservations: reservations.length,
      tickets: tickets.length,
    });

    return {
      complaints,
      reservations,
      tickets, // Legacy, kept for backward compatibility
      combined,
      total: complaints.length + reservations.length + tickets.length,
    };
  } catch (error: any) {
    logger.error('Failed to fetch user history', {
      wa_user_id,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get readable label for complaint category
 */
function getKategoriLabel(kategori: string): string {
  const labels: Record<string, string> = {
    jalan_rusak: 'Jalan Rusak',
    lampu_mati: 'Lampu Mati',
    sampah: 'Sampah',
    drainase: 'Drainase',
    pohon_tumbang: 'Pohon Tumbang',
    fasilitas_rusak: 'Fasilitas Rusak',
    banjir: 'Banjir',
    lainnya: 'Lainnya',
  };
  return labels[kategori] || kategori;
}

/**
 * Get reservation description
 */
function getReservationDescription(reservation: {
  service_code: string;
  reservation_date: Date;
  reservation_time: string;
  queue_number: number | null;
  service?: { name: string } | null;
}): string {
  const serviceName = reservation.service?.name || getServiceLabel(reservation.service_code);
  const dateStr = reservation.reservation_date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
  });
  return `${serviceName} - ${dateStr} ${reservation.reservation_time}`;
}

/**
 * Get service label from code
 */
function getServiceLabel(serviceCode: string): string {
  const labels: Record<string, string> = {
    SKD: 'Surat Keterangan Domisili',
    SKTM: 'Surat Keterangan Tidak Mampu',
    SKU: 'Surat Keterangan Usaha',
    SKBM: 'Surat Keterangan Belum Menikah',
    SPKTP: 'Surat Pengantar KTP',
    SPKK: 'Surat Pengantar KK',
    SPSKCK: 'Surat Pengantar SKCK',
    SPAKTA: 'Surat Pengantar Akta',
    IKR: 'Izin Keramaian',
    SKK: 'Surat Keterangan Kematian',
    SPP: 'Surat Pengantar Pindah',
  };
  return labels[serviceCode] || serviceCode;
}

/**
 * Get ticket description from jenis and data_json
 * @deprecated Legacy function for old ticket data
 */
function getTicketDescription(jenis: string, data_json: any): string {
  // Try to get description from data_json first
  if (data_json && typeof data_json === 'object') {
    if (data_json.deskripsi) return data_json.deskripsi;
    if (data_json.keperluan) return data_json.keperluan;
  }

  // Fallback to jenis label
  const labels: Record<string, string> = {
    surat_keterangan: 'Surat Keterangan',
    surat_pengantar: 'Surat Pengantar',
    izin_keramaian: 'Izin Keramaian',
  };
  return labels[jenis] || jenis;
}
