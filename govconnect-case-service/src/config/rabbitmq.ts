export const RABBITMQ_CONFIG = {
  EXCHANGE_NAME: 'govconnect.events',
  EXCHANGE_TYPE: 'topic',
  ROUTING_KEYS: {
    COMPLAINT_CREATED: 'govconnect.complaint.created',
    SERVICE_REQUESTED: 'govconnect.service.requested',
    STATUS_UPDATED: 'govconnect.status.updated',
    URGENT_ALERT: 'govconnect.urgent.alert',
  },
};

// Kategori yang dianggap sebagai laporan darurat
export const URGENT_CATEGORIES = [
  'bencana',
  'bencana_alam',
  'kebakaran',
  'kecelakaan',
  'keamanan',
  'kriminalitas',
  'tindakan_kriminal', // pencurian, perampokan, vandalisme
  'kesehatan_darurat',
  'banjir',
  'tanah_longsor',
  'gempa',
];

export function isUrgentCategory(kategori: string): boolean {
  const normalizedKategori = kategori.toLowerCase().replace(/[^a-z_]/g, '');
  return URGENT_CATEGORIES.some(urgent => 
    normalizedKategori.includes(urgent) || urgent.includes(normalizedKategori)
  );
}
