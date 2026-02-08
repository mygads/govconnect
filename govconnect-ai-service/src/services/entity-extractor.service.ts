/**
 * Entity Extractor Service
 * 
 * Ekstraksi entitas terstruktur dari pesan user.
 * Digunakan untuk pre-processing sebelum LLM dan validasi data.
 * 
 * Entities:
 * - NIK (16 digit)
 * - Phone number (08xxx)
 * - Name
 * - Address
 * - Date (Indonesian format)
 * - Time
 * - Complaint/Service Request IDs
 */

import logger from '../utils/logger';

// ==================== TYPES ====================

export interface ExtractedEntities {
  nik?: string;
  phone?: string;
  name?: string;
  address?: string;
  date?: string;        // ISO format YYYY-MM-DD
  time?: string;        // HH:MM format
  complaintId?: string;
  requestNumber?: string;
  email?: string;
  rtRw?: string;
}

export interface ExtractionResult {
  entities: ExtractedEntities;
  confidence: number;
  extractedCount: number;
}

// ==================== EXTRACTION FUNCTIONS ====================

/**
 * Extract NIK (16 digit Indonesian ID number)
 */
export function extractNIK(text: string): string | null {
  // Pattern: exactly 16 digits, not part of longer number
  const patterns = [
    /(?:nik|NIK)[\s:]+(\d{16})\b/,           // "NIK: 1234567890123456"
    /(?:nomor\s+induk)[\s:]+(\d{16})\b/i,    // "nomor induk: ..."
    /\b(\d{16})\b/,                           // Standalone 16 digits
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const nik = match[1];
      // Basic validation: first 6 digits are province/city code
      if (isValidNIKFormat(nik)) {
        return nik;
      }
    }
  }
  
  return null;
}

/**
 * Basic NIK format validation
 */
function isValidNIKFormat(nik: string): boolean {
  if (nik.length !== 16) return false;
  if (!/^\d+$/.test(nik)) return false;
  
  // First 2 digits: province code (01-99)
  const provinceCode = parseInt(nik.substring(0, 2));
  if (provinceCode < 1 || provinceCode > 99) return false;
  
  // Digits 7-8: birth date (01-31 for male, 41-71 for female)
  const birthDate = parseInt(nik.substring(6, 8));
  if (!((birthDate >= 1 && birthDate <= 31) || (birthDate >= 41 && birthDate <= 71))) {
    return false;
  }
  
  return true;
}

/**
 * Extract Indonesian phone number
 */
export function extractPhone(text: string): string | null {
  const patterns = [
    /(?:hp|no\.?\s*hp|nomor\s*hp|telepon|telp|wa|whatsapp)[\s:]+(\+?62|0)(\d{8,12})\b/i,
    /\b(\+?62|0)(8\d{8,11})\b/,  // Indonesian mobile format
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // Normalize to 08xxx format
      let phone = match[2] || match[1];
      if (phone.startsWith('+62')) {
        phone = '0' + phone.substring(3);
      } else if (phone.startsWith('62')) {
        phone = '0' + phone.substring(2);
      }
      
      // Validate length (10-13 digits)
      if (phone.length >= 10 && phone.length <= 13 && phone.startsWith('08')) {
        return phone;
      }
    }
  }
  
  // Fallback: look for standalone phone pattern
  const standaloneMatch = text.match(/\b(08\d{8,11})\b/);
  if (standaloneMatch) {
    return standaloneMatch[1];
  }
  
  return null;
}

/**
 * Extract name from text
 */
export function extractName(text: string): string | null {
  const patterns = [
    /(?:nama\s+saya|saya)\s+([A-Za-z]+(?:\s+[A-Za-z]+){0,3})/i,
    /(?:nama|name)[\s:]+([A-Za-z]+(?:\s+[A-Za-z]+){0,3})/i,
    /(?:panggil\s+saya|panggil)\s+([A-Za-z]+)/i,
    /(?:gw|gue|gua|aku)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      
      // Validate name
      if (isValidName(name)) {
        // Capitalize first letter of each word
        return name.split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
      }
    }
  }
  
  return null;
}

/**
 * Validate extracted name
 */
function isValidName(name: string): boolean {
  // Must be 2-50 characters
  if (name.length < 2 || name.length > 50) return false;
  
  // Must not contain numbers
  if (/\d/.test(name)) return false;
  
  // Must not be common words
  const invalidNames = [
    'saya', 'aku', 'gue', 'gw', 'mau', 'ingin', 'perlu', 'butuh',
    'buat', 'bikin', 'urus', 'daftar', 'layanan', 'lapor',
    'ya', 'tidak', 'oke', 'baik', 'terima', 'kasih',
  ];
  if (invalidNames.includes(name.toLowerCase())) return false;
  
  return true;
}

/**
 * Extract address from text
 */
export function extractAddress(text: string): string | null {
  const patterns = [
    // Explicit address patterns
    /(?:alamat|tinggal\s+di|domisili|lokasi)[\s:]+(.+?)(?:\s*[,.]?\s*(?:untuk|mau|nik|hp|nama|no)|$)/i,
    /(?:di|ke)\s+(jalan|jln|jl\.?)\s+(.+?)(?:\s*[,.]?\s*(?:untuk|mau|nik|hp|nama)|$)/i,
    
    // Street patterns
    /\b(jalan|jln|jl\.?)\s+([a-z0-9\s]+(?:no\.?\s*\d+)?(?:\s+rt\.?\s*\d+)?(?:\s+rw\.?\s*\d+)?)/i,
    
    // Landmark patterns
    /(?:dekat|depan|belakang|samping|sebelah)\s+(masjid|mushola|sekolah|kantor|warung|toko|pasar|bank|atm|spbu|alfamart|indomaret)\s+([a-z0-9\s]+)/i,
    
    // Komplek/Perumahan patterns
    /\b(komplek|perumahan|perum|cluster)\s+([a-z0-9\s]+)(?:\s+blok\s*[a-z0-9]+)?/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // Get the captured address part
      let address = match[1];
      if (match[2]) {
        address = match[1] + ' ' + match[2];
      }
      
      address = address.trim()
        .replace(/\s+/g, ' ')
        .replace(/[,.]$/, '');
      
      // Validate minimum length
      if (address.length >= 5) {
        return address;
      }
    }
  }
  
  return null;
}

/**
 * Extract RT/RW from text
 */
export function extractRtRw(text: string): string | null {
  const patterns = [
    /\brt\.?\s*(\d{1,3})[\s/,]+rw\.?\s*(\d{1,3})\b/i,
    /\brt\.?\s*(\d{1,3})\b/i,
    /\brw\.?\s*(\d{1,3})\b/i,
  ];
  
  const rtMatch = text.match(/\brt\.?\s*(\d{1,3})\b/i);
  const rwMatch = text.match(/\brw\.?\s*(\d{1,3})\b/i);
  
  if (rtMatch && rwMatch) {
    return `RT ${rtMatch[1].padStart(2, '0')} RW ${rwMatch[1].padStart(2, '0')}`;
  } else if (rtMatch) {
    return `RT ${rtMatch[1].padStart(2, '0')}`;
  } else if (rwMatch) {
    return `RW ${rwMatch[1].padStart(2, '0')}`;
  }
  
  return null;
}

/**
 * Extract date from Indonesian text
 */
export function extractDate(text: string): string | null {
  const today = new Date();
  const lowerText = text.toLowerCase();
  
  // Relative dates
  if (/\b(hari\s+ini|sekarang)\b/i.test(lowerText)) {
    return formatDate(today);
  }
  
  if (/\b(besok|bsk)\b/i.test(lowerText)) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDate(tomorrow);
  }
  
  if (/\b(lusa)\b/i.test(lowerText)) {
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    return formatDate(dayAfter);
  }
  
  // Day names
  const dayNames: Record<string, number> = {
    'senin': 1, 'selasa': 2, 'rabu': 3, 'kamis': 4,
    'jumat': 5, 'sabtu': 6, 'minggu': 0,
  };
  
  for (const [dayName, dayNum] of Object.entries(dayNames)) {
    if (lowerText.includes(dayName)) {
      const targetDate = getNextDayOfWeek(today, dayNum);
      return formatDate(targetDate);
    }
  }
  
  // Indonesian date format: "10 Desember 2025"
  const monthNames: Record<string, number> = {
    'januari': 0, 'februari': 1, 'maret': 2, 'april': 3,
    'mei': 4, 'juni': 5, 'juli': 6, 'agustus': 7,
    'september': 8, 'oktober': 9, 'november': 10, 'desember': 11,
  };
  
  const dateMatch = text.match(/(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)(?:\s+(\d{4}))?/i);
  if (dateMatch) {
    const day = parseInt(dateMatch[1]);
    const month = monthNames[dateMatch[2].toLowerCase()];
    const year = dateMatch[3] ? parseInt(dateMatch[3]) : today.getFullYear();
    
    const date = new Date(year, month, day);
    if (isValidDate(date)) {
      return formatDate(date);
    }
  }
  
  // ISO format: "2025-12-10"
  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return isoMatch[0];
  }
  
  // DD/MM/YYYY or DD-MM-YYYY
  const slashMatch = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1]);
    const month = parseInt(slashMatch[2]) - 1;
    const year = parseInt(slashMatch[3]);
    
    const date = new Date(year, month, day);
    if (isValidDate(date)) {
      return formatDate(date);
    }
  }
  
  return null;
}

/**
 * Extract time from Indonesian text
 */
export function extractTime(text: string): string | null {
  const lowerText = text.toLowerCase();
  
  // "jam 9 pagi", "jam 2 siang", "jam 7 malam"
  const jamMatch = lowerText.match(/jam\s*(\d{1,2})(?::(\d{2}))?\s*(pagi|siang|sore|malam)?/i);
  if (jamMatch) {
    let hour = parseInt(jamMatch[1]);
    const minute = jamMatch[2] ? parseInt(jamMatch[2]) : 0;
    const period = jamMatch[3]?.toLowerCase();
    
    // Adjust for period
    if (period === 'siang' && hour < 12 && hour !== 12) {
      // Keep as is for 10, 11
    } else if (period === 'sore' && hour < 12) {
      hour += 12;
    } else if (period === 'malam' && hour < 12) {
      hour += 12;
    } else if (period === 'pagi' && hour === 12) {
      hour = 0;
    }
    
    // Validate time range (00:00 - 23:59)
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    }
  }
  
  // HH:MM format
  const timeMatch = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (timeMatch) {
    const hour = parseInt(timeMatch[1]);
    const minute = parseInt(timeMatch[2]);
    
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    }
  }
  
  // "pukul 9", "pkl 10"
  const pukulMatch = lowerText.match(/(?:pukul|pkl)\s*(\d{1,2})(?::(\d{2}))?/i);
  if (pukulMatch) {
    const hour = parseInt(pukulMatch[1]);
    const minute = pukulMatch[2] ? parseInt(pukulMatch[2]) : 0;
    
    if (hour >= 0 && hour <= 23) {
      return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    }
  }
  
  return null;
}

/**
 * Extract complaint ID
 */
export function extractComplaintId(text: string): string | null {
  const match = text.match(/\b(LAP-\d{8}-\d{3})\b/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Extract service request number
 */
export function extractRequestNumber(text: string): string | null {
  const match = text.match(/\b(LAY-\d{8}-\d{3})\b/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Extract email
 */
export function extractEmail(text: string): string | null {
  const match = text.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
  return match ? match[1].toLowerCase() : null;
}

// ==================== HELPER FUNCTIONS ====================

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function isValidDate(date: Date): boolean {
  return date instanceof Date && !isNaN(date.getTime());
}

function getNextDayOfWeek(from: Date, dayOfWeek: number): Date {
  const result = new Date(from);
  const currentDay = result.getDay();
  let daysToAdd = dayOfWeek - currentDay;
  
  if (daysToAdd <= 0) {
    daysToAdd += 7; // Next week
  }
  
  result.setDate(result.getDate() + daysToAdd);
  return result;
}

// ==================== MAIN EXTRACTION ====================

/**
 * Extract all entities from text
 */
export function extractAllEntities(text: string, history?: string): ExtractionResult {
  const combined = history ? `${history} ${text}` : text;
  
  const entities: ExtractedEntities = {};
  let extractedCount = 0;
  
  // Extract each entity type
  const nik = extractNIK(combined);
  if (nik) { entities.nik = nik; extractedCount++; }
  
  const phone = extractPhone(combined);
  if (phone) { entities.phone = phone; extractedCount++; }
  
  const name = extractName(combined);
  if (name) { entities.name = name; extractedCount++; }
  
  const address = extractAddress(combined);
  if (address) { entities.address = address; extractedCount++; }
  
  const rtRw = extractRtRw(combined);
  if (rtRw) { entities.rtRw = rtRw; extractedCount++; }
  
  const date = extractDate(text); // Only from current message
  if (date) { entities.date = date; extractedCount++; }
  
  const time = extractTime(text); // Only from current message
  if (time) { entities.time = time; extractedCount++; }
  
  const complaintId = extractComplaintId(combined);
  if (complaintId) { entities.complaintId = complaintId; extractedCount++; }
  
  const requestNumber = extractRequestNumber(combined);
  if (requestNumber) { entities.requestNumber = requestNumber; extractedCount++; }
  
  const email = extractEmail(combined);
  if (email) { entities.email = email; extractedCount++; }
  
  // Calculate confidence based on extraction count
  const confidence = Math.min(1, extractedCount * 0.15 + 0.4);
  
  logger.debug('[EntityExtractor] Extraction completed', {
    extractedCount,
    confidence,
    entities: Object.keys(entities),
  });
  
  return {
    entities,
    confidence,
    extractedCount,
  };
}

/**
 * Merge extracted entities with existing data (fill gaps only)
 */
export function mergeEntities(
  existing: Record<string, any>,
  extracted: ExtractedEntities
): Record<string, any> {
  const merged = { ...existing };
  
  // Only fill empty fields
  if (!merged.nik && extracted.nik) merged.nik = extracted.nik;
  if (!merged.no_hp && extracted.phone) merged.no_hp = extracted.phone;
  if (!merged.nama_lengkap && extracted.name) merged.nama_lengkap = extracted.name;
  if (!merged.alamat && extracted.address) merged.alamat = extracted.address;
  if (!merged.rt_rw && extracted.rtRw) merged.rt_rw = extracted.rtRw;
  if (!merged.complaint_id && extracted.complaintId) merged.complaint_id = extracted.complaintId;
  if (!merged.request_number && extracted.requestNumber) merged.request_number = extracted.requestNumber;
  
  return merged;
}

export default {
  extractAllEntities,
  mergeEntities,
  extractNIK,
  extractPhone,
  extractName,
  extractAddress,
  extractRtRw,
  extractDate,
  extractTime,
  extractComplaintId,
  extractRequestNumber,
  extractEmail,
};
