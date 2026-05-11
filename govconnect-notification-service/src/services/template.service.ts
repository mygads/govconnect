export function buildAIReplyMessage(reply_text: string): string {
  return reply_text;
}

export function buildComplaintCreatedMessage(data: {
  complaint_id: string;
  kategori: string;
  village_name?: string;
}): string {
  const kategoriText = formatKategori(data.kategori).toLowerCase();
  const desaInfo = data.village_name ? ` (${data.village_name})` : '';
  
  return `✅ *Laporan Diterima*${desaInfo}

No: *${data.complaint_id}*
Kategori: ${kategoriText}

Kami akan segera menindaklanjuti. Anda akan dinotifikasi saat selesai.`;
}

export function buildComplaintImportantContactsMessage(data: {
  complaint_id: string;
  contacts: Array<{
    name: string;
    phone: string;
    description?: string | null;
  }>;
}): string {
  const lines = data.contacts.map((contact) => {
    const desc = contact.description ? ` (${contact.description})` : '';
    return `• ${contact.name}: ${contact.phone}${desc}`;
  });

  return `📞 *Nomor Penting Terkait*

Berikut kontak resmi yang terkait dengan laporan *${data.complaint_id}*:
${lines.join('\n')}

Silakan hubungi jika memang diperlukan.`;
}

type NotificationChannel = 'WHATSAPP' | 'WEBCHAT';

export function buildServiceRequestedMessage(data: {
  request_number: string;
  service_name?: string;
  channel?: NotificationChannel;
}): string {
  const updateChannelLabel = data.channel === 'WEBCHAT'
    ? 'melalui percakapan ini'
    : 'melalui WhatsApp ini';

  return `🎫 *Permohonan Layanan Diterima*

No: *${data.request_number}*
Layanan: ${data.service_name || 'Layanan Administrasi'}

Permohonan Anda sudah kami terima. Anda akan mendapat update status ${updateChannelLabel}.`;
}

export function buildStatusUpdatedMessage(data: {
  complaint_id?: string;
  request_number?: string;
  status: string;
  admin_notes?: string;
  result_file_url?: string;
  result_file_name?: string;
}): string {
  const id = data.complaint_id || data.request_number;
  const isComplaint = !!data.complaint_id;
  
  return buildNaturalStatusMessage(id!, data.status, data.admin_notes, isComplaint, data.result_file_url, data.result_file_name);
}

function buildNaturalStatusMessage(
  id: string, 
  status: string, 
  adminNotes?: string,
  isComplaint: boolean = true,
  resultFileUrl?: string,
  resultFileName?: string,
): string {
  const type = isComplaint ? 'Laporan' : 'Layanan';
  
  switch (status) {
    case 'DONE':
      let selesaiMsg = `✅ *${type} Selesai*\n\n*${id}* telah selesai ditangani.`;
      if (adminNotes) {
        selesaiMsg += `\n\n📝 _${adminNotes}_`;
      }
      if (resultFileUrl) {
        const fileName = resultFileName || 'Dokumen Hasil';
        selesaiMsg += `\n\n📎 *${fileName}*\nUnduh file hasil di sini:\n${resultFileUrl}`;
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
  village_name?: string;
}): string {
  const kategoriText = formatKategori(data.kategori);
  const waktu = new Date(data.created_at).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  const desaLabel = data.village_name ? ` - ${data.village_name}` : '';
  
  let message = `🚨 *LAPORAN DARURAT${desaLabel}* 🚨

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
