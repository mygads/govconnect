export function buildAIReplyMessage(reply_text: string): string {
  return reply_text;
}

export function buildComplaintCreatedMessage(data: {
  complaint_id: string;
  kategori: string;
}): string {
  const kategoriText = formatKategori(data.kategori).toLowerCase();
  
  return `✅ *Laporan Diterima*

No: *${data.complaint_id}*
Kategori: ${kategoriText}

Kami akan segera menindaklanjuti. Anda akan dinotifikasi saat selesai.`;
}

export function buildServiceRequestedMessage(data: {
  request_number: string;
  service_name?: string;
}): string {
  return `🎫 *Permohonan Layanan Diterima*

No: *${data.request_number}*
Layanan: ${data.service_name || 'Layanan Administrasi'}

Permohonan Anda sudah kami terima. Anda akan mendapat update status melalui WhatsApp ini.`;
}

export function buildStatusUpdatedMessage(data: {
  complaint_id?: string;
  request_number?: string;
  status: string;
  admin_notes?: string;
}): string {
  const id = data.complaint_id || data.request_number;
  const isComplaint = !!data.complaint_id;
  
  return buildNaturalStatusMessage(id!, data.status, data.admin_notes, isComplaint);
}

function buildNaturalStatusMessage(
  id: string, 
  status: string, 
  adminNotes?: string,
  isComplaint: boolean = true
): string {
  const type = isComplaint ? 'Laporan' : 'Layanan';
  
  switch (status) {
    case 'DONE':
      let selesaiMsg = `✅ *${type} Selesai*\n\n*${id}* telah selesai ditangani.`;
      if (adminNotes) {
        selesaiMsg += `\n\n📝 _${adminNotes}_`;
      }
      selesaiMsg += `\n\nTerima kasih telah menggunakan layanan kami.`;
      return selesaiMsg;
    
    case 'OPEN':
      return `📥 *${type} Diterima*\n\n*${id}* sudah kami terima.`;
    
    case 'PROCESS':
      let prosesMsg = `🔄 *${type} Diproses*\n\n*${id}* sedang ditangani.`;
      if (adminNotes) {
        prosesMsg += `\n\n📝 _${adminNotes}_`;
      }
      return prosesMsg;
    
    case 'CANCELED':
      return `🔴 *${type} Dibatalkan*\n\n*${id}* telah dibatalkan.${adminNotes ? `\n\n📝 Keterangan: ${adminNotes}` : ''}`;
    case 'REJECT':
      return `❌ *${type} Ditolak*\n\n*${id}* tidak dapat diproses.${adminNotes ? `\n\n📝 Alasan penolakan: ${adminNotes}` : ''}`;
    
    default:
      return `📢 *Update ${type}*\n\n*${id}*: ${status}`;
  }
}

/**
 * Convert snake_case slug to human-readable label
 * Dynamic — no hardcoded category map needed
 */
function formatKategori(kategori: string): string {
  if (!kategori) return 'Lainnya';
  return kategori
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function buildUrgentAlertMessage(data: {
  complaint_id: string;
  kategori: string;
  deskripsi: string;
  alamat?: string;
  rt_rw?: string;
  created_at: string;
}): string {
  const kategoriText = formatKategori(data.kategori);
  const waktu = new Date(data.created_at).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  let message = `🚨 *LAPORAN DARURAT* 🚨

*ID:* ${data.complaint_id}
*Kategori:* ${kategoriText}
*Waktu:* ${waktu}`;

  if (data.alamat) {
    message += `\n*Alamat:* ${data.alamat}`;
  }
  
  if (data.rt_rw) {
    message += `\n*RT/RW:* ${data.rt_rw}`;
  }

  message += `\n\n*Deskripsi:*\n${data.deskripsi}`;
  
  message += `\n\n⚠️ *Mohon segera ditindaklanjuti!*`;
  message += `\n\nBuka dashboard: ${process.env.DASHBOARD_URL || 'http://localhost:3000'}/dashboard/laporan`;
  
  return message;
}
