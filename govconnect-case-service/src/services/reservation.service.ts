import prisma from '../config/database';
import { publishEvent } from './rabbitmq.service';
import { RABBITMQ_CONFIG } from '../config/rabbitmq';
import logger from '../utils/logger';
import { GOVERNMENT_SERVICES, getServiceByCode, DEFAULT_OPERATING_HOURS } from '../config/services';

// ==================== INTERFACES ====================

export interface CitizenData {
  nama_lengkap: string;
  nik: string;
  alamat: string;
  no_hp: string;
  [key: string]: any; // untuk field tambahan per layanan
}

export interface CreateReservationData {
  wa_user_id: string;
  service_code: string;
  citizen_data: CitizenData;
  reservation_date: Date;
  reservation_time: string;
}

export interface UpdateReservationStatusData {
  status: string;
  admin_notes?: string;
}

export interface ReservationFilters {
  status?: string;
  service_id?: string;
  wa_user_id?: string;
  date_from?: Date;
  date_to?: Date;
  limit?: number;
  offset?: number;
}

// ==================== ID GENERATOR ====================

async function generateReservationId(): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  
  // Count reservations today
  const startOfDay = new Date(today.setHours(0, 0, 0, 0));
  const endOfDay = new Date(today.setHours(23, 59, 59, 999));
  
  const count = await prisma.reservation.count({
    where: {
      created_at: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });
  
  const sequence = String(count + 1).padStart(3, '0');
  return `RSV-${dateStr}-${sequence}`;
}

// ==================== SERVICE MANAGEMENT ====================

/**
 * Initialize services in database from config
 * Called on service startup
 */
export async function initializeServices() {
  logger.info('Initializing government services...');
  
  for (const serviceDef of GOVERNMENT_SERVICES) {
    const existing = await prisma.service.findUnique({
      where: { code: serviceDef.code },
    });
    
    if (!existing) {
      await prisma.service.create({
        data: {
          code: serviceDef.code,
          name: serviceDef.name,
          description: serviceDef.description,
          category: serviceDef.category,
          requirements: serviceDef.requirements,
          sop_steps: serviceDef.sop_steps,
          estimated_duration: serviceDef.estimated_duration,
          daily_quota: serviceDef.daily_quota,
          operating_hours: DEFAULT_OPERATING_HOURS,
          is_active: true,
          is_online_available: true,
        },
      });
      logger.info(`Created service: ${serviceDef.code} - ${serviceDef.name}`);
    }
  }
  
  logger.info('Government services initialized');
}

/**
 * Get all services with their status
 */
export async function getAllServices() {
  return prisma.service.findMany({
    orderBy: [
      { category: 'asc' },
      { name: 'asc' },
    ],
  });
}

/**
 * Get active services only
 */
export async function getActiveServices() {
  return prisma.service.findMany({
    where: {
      is_active: true,
      is_online_available: true,
    },
    orderBy: [
      { category: 'asc' },
      { name: 'asc' },
    ],
  });
}

/**
 * Get service by code
 */
export async function getServiceByCodeFromDb(code: string) {
  return prisma.service.findUnique({
    where: { code },
  });
}

/**
 * Toggle service active status
 */
export async function toggleServiceActive(code: string, is_active: boolean) {
  return prisma.service.update({
    where: { code },
    data: { is_active },
  });
}

/**
 * Toggle service online availability
 */
export async function toggleServiceOnline(code: string, is_online_available: boolean) {
  return prisma.service.update({
    where: { code },
    data: { is_online_available },
  });
}

/**
 * Update service settings
 */
export async function updateServiceSettings(
  code: string,
  data: {
    daily_quota?: number;
    operating_hours?: any;
  }
) {
  return prisma.service.update({
    where: { code },
    data,
  });
}

// ==================== RESERVATION MANAGEMENT ====================

/**
 * Check available slots for a service on a specific date
 */
export async function getAvailableSlots(serviceCode: string, date: Date) {
  const service = await prisma.service.findUnique({
    where: { code: serviceCode },
  });
  
  if (!service || !service.is_active || !service.is_online_available) {
    return { available: false, message: 'Layanan tidak tersedia untuk reservasi online' };
  }
  
  // Get day of week
  const days = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
  const dayName = days[date.getDay()];
  
  const operatingHours = service.operating_hours as any;
  const dayHours = operatingHours?.[dayName];
  
  if (!dayHours) {
    return { available: false, message: `Layanan tutup pada hari ${dayName}` };
  }
  
  // Get existing reservations for that date
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  const existingReservations = await prisma.reservation.findMany({
    where: {
      service_id: service.id,
      reservation_date: {
        gte: startOfDay,
        lte: endOfDay,
      },
      status: {
        notIn: ['cancelled', 'no_show'],
      },
    },
    select: {
      reservation_time: true,
    },
  });
  
  // Check quota
  if (existingReservations.length >= service.daily_quota) {
    return { available: false, message: 'Kuota reservasi hari ini sudah penuh' };
  }
  
  // Generate available time slots
  const bookedTimes = existingReservations.map(r => r.reservation_time);
  const allSlots = generateTimeSlots(dayHours.open, dayHours.close);
  const availableSlots = allSlots.filter(slot => !bookedTimes.includes(slot));
  
  return {
    available: true,
    service,
    date: date.toISOString().slice(0, 10),
    operating_hours: dayHours,
    total_quota: service.daily_quota,
    booked: existingReservations.length,
    remaining: service.daily_quota - existingReservations.length,
    available_slots: availableSlots,
  };
}

function generateTimeSlots(open: string, close: string): string[] {
  const slots: string[] = [];
  const [openHour, openMin] = open.split(':').map(Number);
  const [closeHour, closeMin] = close.split(':').map(Number);
  
  let currentHour = openHour;
  let currentMin = openMin;
  
  while (currentHour < closeHour || (currentHour === closeHour && currentMin < closeMin)) {
    slots.push(`${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`);
    currentMin += 30;
    if (currentMin >= 60) {
      currentMin = 0;
      currentHour++;
    }
  }
  
  return slots;
}

/**
 * Create new reservation
 */
export async function createReservation(data: CreateReservationData) {
  const service = await prisma.service.findUnique({
    where: { code: data.service_code },
  });
  
  if (!service) {
    throw new Error('Layanan tidak ditemukan');
  }
  
  if (!service.is_active || !service.is_online_available) {
    throw new Error('Layanan tidak tersedia untuk reservasi online');
  }
  
  // Check slot availability
  const availability = await getAvailableSlots(data.service_code, data.reservation_date);
  if (!availability.available) {
    throw new Error(availability.message);
  }
  
  if (!availability.available_slots?.includes(data.reservation_time)) {
    throw new Error('Slot waktu tidak tersedia');
  }
  
  // Generate reservation ID and queue number
  const reservation_id = await generateReservationId();
  
  // Get queue number for that day
  const startOfDay = new Date(data.reservation_date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(data.reservation_date);
  endOfDay.setHours(23, 59, 59, 999);
  
  const queueCount = await prisma.reservation.count({
    where: {
      service_id: service.id,
      reservation_date: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });
  
  const reservation = await prisma.reservation.create({
    data: {
      reservation_id,
      wa_user_id: data.wa_user_id,
      service_id: service.id,
      citizen_data: data.citizen_data,
      reservation_date: data.reservation_date,
      reservation_time: data.reservation_time,
      queue_number: queueCount + 1,
      status: 'pending',
    },
    include: {
      service: true,
    },
  });
  
  // Publish event
  await publishEvent(RABBITMQ_CONFIG.ROUTING_KEYS.TICKET_CREATED, {
    type: 'reservation',
    wa_user_id: data.wa_user_id,
    reservation_id: reservation.reservation_id,
    service_name: service.name,
    reservation_date: data.reservation_date,
    reservation_time: data.reservation_time,
    queue_number: reservation.queue_number,
  });
  
  logger.info('Reservation created', { reservation_id });
  
  return reservation;
}

/**
 * Get reservation by ID
 */
export async function getReservationById(id: string) {
  // Try by reservation_id first
  let reservation = await prisma.reservation.findUnique({
    where: { reservation_id: id },
    include: { service: true },
  });
  
  // If not found, try by database id
  if (!reservation) {
    reservation = await prisma.reservation.findUnique({
      where: { id },
      include: { service: true },
    });
  }
  
  return reservation;
}

/**
 * Get reservations list with filters
 */
export async function getReservationsList(filters: ReservationFilters) {
  const { status, service_id, wa_user_id, date_from, date_to, limit = 20, offset = 0 } = filters;
  
  const where: any = {};
  if (status) where.status = status;
  if (service_id) where.service_id = service_id;
  if (wa_user_id) where.wa_user_id = wa_user_id;
  if (date_from || date_to) {
    where.reservation_date = {};
    if (date_from) where.reservation_date.gte = date_from;
    if (date_to) where.reservation_date.lte = date_to;
  }
  
  const [data, total] = await Promise.all([
    prisma.reservation.findMany({
      where,
      include: { service: true },
      orderBy: [
        { reservation_date: 'desc' },
        { reservation_time: 'asc' },
      ],
      take: limit,
      skip: offset,
    }),
    prisma.reservation.count({ where }),
  ]);
  
  return { data, total, limit, offset };
}

/**
 * Update reservation status
 */
export async function updateReservationStatus(
  id: string,
  updateData: UpdateReservationStatusData
) {
  const existing = await getReservationById(id);
  if (!existing) {
    throw new Error('Reservasi tidak ditemukan');
  }
  
  const statusTimestamps: any = {};
  switch (updateData.status) {
    case 'confirmed':
      statusTimestamps.confirmed_at = new Date();
      break;
    case 'arrived':
      statusTimestamps.arrived_at = new Date();
      break;
    case 'completed':
      statusTimestamps.completed_at = new Date();
      break;
    case 'cancelled':
      statusTimestamps.cancelled_at = new Date();
      break;
  }
  
  const reservation = await prisma.reservation.update({
    where: { id: existing.id },
    data: {
      status: updateData.status,
      admin_notes: updateData.admin_notes,
      ...statusTimestamps,
    },
    include: { service: true },
  });
  
  // Publish event
  await publishEvent(RABBITMQ_CONFIG.ROUTING_KEYS.STATUS_UPDATED, {
    type: 'reservation',
    wa_user_id: reservation.wa_user_id,
    reservation_id: reservation.reservation_id,
    status: reservation.status,
    admin_notes: reservation.admin_notes,
  });
  
  logger.info('Reservation status updated', {
    reservation_id: reservation.reservation_id,
    status: updateData.status,
  });
  
  return reservation;
}

/**
 * Cancel reservation by user
 * 
 * Status yang TIDAK BISA dibatalkan:
 * - completed (sudah selesai)
 * - cancelled (sudah dibatalkan)
 * - no_show (tidak hadir)
 * - arrived (sudah hadir di lokasi)
 * 
 * Status yang BISA dibatalkan:
 * - pending (menunggu konfirmasi)
 * - confirmed (dikonfirmasi)
 */
export async function cancelReservation(
  id: string,
  wa_user_id: string,
  cancel_reason?: string
) {
  const reservation = await getReservationById(id);
  
  if (!reservation) {
    return { success: false, error: 'NOT_FOUND', message: 'Reservasi tidak ditemukan' };
  }
  
  if (reservation.wa_user_id !== wa_user_id) {
    return { success: false, error: 'NOT_OWNER', message: 'Anda tidak memiliki akses untuk membatalkan reservasi ini' };
  }
  
  // Status yang tidak bisa dibatalkan dengan pesan yang informatif
  const nonCancellableStatuses: Record<string, string> = {
    'completed': 'Reservasi sudah selesai dilayani. Silakan buat reservasi baru jika diperlukan.',
    'cancelled': 'Reservasi ini sudah dibatalkan sebelumnya. Silakan buat reservasi baru jika diperlukan.',
    'no_show': 'Reservasi ini ditandai tidak hadir. Silakan buat reservasi baru jika diperlukan.',
    'arrived': 'Reservasi tidak dapat dibatalkan karena Anda sudah hadir di lokasi. Silakan hubungi petugas langsung.',
  };
  
  if (nonCancellableStatuses[reservation.status]) {
    return { 
      success: false, 
      error: 'CANNOT_CANCEL', 
      message: nonCancellableStatuses[reservation.status],
      current_status: reservation.status,
    };
  }
  
  const updated = await prisma.reservation.update({
    where: { id: reservation.id },
    data: {
      status: 'cancelled',
      cancel_reason: cancel_reason || 'Dibatalkan oleh pemohon',
      cancelled_at: new Date(),
    },
  });
  
  await publishEvent(RABBITMQ_CONFIG.ROUTING_KEYS.STATUS_UPDATED, {
    type: 'reservation',
    wa_user_id: updated.wa_user_id,
    reservation_id: updated.reservation_id,
    status: 'cancelled',
  });
  
  logger.info('Reservation cancelled', { reservation_id: updated.reservation_id });
  
  return { success: true, reservation_id: updated.reservation_id };
}

/**
 * Update reservation time by user
 * 
 * Status yang TIDAK BISA diubah jamnya:
 * - completed (sudah selesai)
 * - cancelled (sudah dibatalkan)
 * - no_show (tidak hadir)
 * - arrived (sudah hadir di lokasi)
 * 
 * Status yang BISA diubah jamnya:
 * - pending (menunggu konfirmasi)
 * - confirmed (dikonfirmasi)
 */
export async function updateReservationTime(
  id: string,
  wa_user_id: string,
  new_date: Date,
  new_time: string
) {
  const reservation = await getReservationById(id);
  
  if (!reservation) {
    return { success: false, error: 'NOT_FOUND', message: 'Reservasi tidak ditemukan' };
  }
  
  if (reservation.wa_user_id !== wa_user_id) {
    return { success: false, error: 'NOT_OWNER', message: 'Anda tidak memiliki akses untuk mengubah reservasi ini' };
  }
  
  // Status yang tidak bisa diubah dengan pesan yang informatif
  const nonModifiableStatuses: Record<string, string> = {
    'completed': 'Reservasi sudah selesai dilayani. Silakan buat reservasi baru dengan jadwal yang diinginkan.',
    'cancelled': 'Reservasi ini sudah dibatalkan. Silakan buat reservasi baru dengan jadwal yang diinginkan.',
    'no_show': 'Reservasi ini ditandai tidak hadir. Silakan buat reservasi baru dengan jadwal yang diinginkan.',
    'arrived': 'Reservasi tidak dapat diubah karena Anda sudah hadir di lokasi. Silakan hubungi petugas langsung.',
  };
  
  if (nonModifiableStatuses[reservation.status]) {
    return { 
      success: false, 
      error: 'CANNOT_MODIFY', 
      message: nonModifiableStatuses[reservation.status],
      current_status: reservation.status,
    };
  }
  
  // Check slot availability for new time
  const availability = await getAvailableSlots(reservation.service.code, new_date);
  if (!availability.available) {
    return { success: false, error: 'SLOT_UNAVAILABLE', message: availability.message };
  }
  
  if (!availability.available_slots?.includes(new_time)) {
    return { success: false, error: 'TIME_UNAVAILABLE', message: 'Slot waktu yang dipilih tidak tersedia' };
  }
  
  const updated = await prisma.reservation.update({
    where: { id: reservation.id },
    data: {
      reservation_date: new_date,
      reservation_time: new_time,
    },
    include: { service: true },
  });
  
  await publishEvent(RABBITMQ_CONFIG.ROUTING_KEYS.STATUS_UPDATED, {
    type: 'reservation',
    wa_user_id: updated.wa_user_id,
    reservation_id: updated.reservation_id,
    status: updated.status,
    reservation_date: new_date,
    reservation_time: new_time,
  });
  
  logger.info('Reservation time updated', { 
    reservation_id: updated.reservation_id,
    new_date,
    new_time,
  });
  
  return { 
    success: true, 
    reservation_id: updated.reservation_id,
    reservation_date: new_date,
    reservation_time: new_time,
  };
}

/**
 * Get reservation statistics
 */
export async function getReservationStatistics() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const [byStatus, byService, todayCount, weekCount] = await Promise.all([
    prisma.reservation.groupBy({
      by: ['status'],
      _count: { status: true },
    }),
    prisma.reservation.groupBy({
      by: ['service_id'],
      _count: { service_id: true },
    }),
    prisma.reservation.count({
      where: {
        reservation_date: {
          gte: today,
          lt: tomorrow,
        },
      },
    }),
    prisma.reservation.count({
      where: {
        created_at: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    }),
  ]);
  
  return {
    by_status: byStatus,
    by_service: byService,
    today_reservations: todayCount,
    week_reservations: weekCount,
  };
}

/**
 * Get user reservation history
 */
export async function getUserReservationHistory(wa_user_id: string) {
  return prisma.reservation.findMany({
    where: { wa_user_id },
    include: { service: true },
    orderBy: { created_at: 'desc' },
    take: 10,
  });
}
