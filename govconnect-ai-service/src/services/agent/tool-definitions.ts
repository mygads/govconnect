/**
 * Agent Tool Definitions — canonical single-agent tool contract.
 *
 * This matches the enterprise audit direction: one orchestrator agent with a
 * small deterministic tool surface, plus explicit retrieval and action tools.
 * `search_documents` is kept as a non-redundant extension because the
 * codebase already separates uploaded-document retrieval from curated KB.
 */

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_village_profile',
      description:
        'Profil desa resmi: nama, alamat kantor, jam operasional, kontak kantor, dan Google Maps. ' +
        'Gunakan untuk pertanyaan alamat, jam buka, lokasi, atau kontak kantor desa.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_service_info',
      description:
        'Detail layanan administrasi: daftar layanan aktif, persyaratan, mode layanan, dan link formulir online jika tersedia. ' +
        'Gunakan untuk pertanyaan syarat, biaya, proses, dokumen, surat, atau layanan kependudukan. ' +
        'Jika service_name kosong, tool boleh dipakai untuk menampilkan layanan aktif yang tersedia.',
      parameters: {
        type: 'object',
        properties: {
          service_name: {
            type: 'string',
            description: 'Nama layanan spesifik jika user menanyakan layanan tertentu. Contoh: "KTP", "SKTM", "surat pindah".',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_complaint_categories',
      description:
        'Daftar kategori pengaduan resmi yang tersedia di desa ini, termasuk penanda kategori darurat bila ada.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_emergency_contacts',
      description:
        'Nomor darurat dan kontak penting publik seperti pemadam, ambulans, polisi, puskesmas, atau fasilitas bantuan cepat lainnya.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description:
        'Cari informasi naratif di knowledge base desa: SOP, FAQ, kebijakan, prosedur, dan panduan. ' +
        'Jangan gunakan untuk jam buka/alamat/kontak kantor atau detail layanan deterministik.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Pertanyaan pencarian dalam bahasa Indonesia yang jelas.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_documents',
      description:
        'Cari isi dokumen upload yang sudah diindeks seperti PDF, Word, lampiran jadwal, atau SOP panjang berbasis dokumen.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Pertanyaan atau topik yang dicari di dokumen.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_complaint',
      description:
        'Buat pengaduan infrastruktur. Wajib ada kategori, alamat, dan deskripsi. ' +
        'Jika nama pelapor atau nomor telepon webchat belum tersedia, tool akan meminta data tambahan dulu.',
      parameters: {
        type: 'object',
        properties: {
          kategori: {
            type: 'string',
            description: 'Kategori pengaduan. Contoh: "jalan_rusak", "lampu_mati", "sampah", "drainase".',
          },
          alamat: {
            type: 'string',
            description: 'Alamat atau lokasi lengkap termasuk RT/RW jika ada.',
          },
          deskripsi: {
            type: 'string',
            description: 'Deskripsi detail masalah, minimal 10 karakter.',
          },
          rt_rw: {
            type: 'string',
            description: 'RT/RW lokasi bila tersedia.',
          },
          nama_pelapor: {
            type: 'string',
            description: 'Nama lengkap pelapor bila user menyebutkannya di chat.',
          },
          no_hp: {
            type: 'string',
            description: 'Nomor HP pelapor, terutama untuk kanal webchat.',
          },
        },
        required: ['kategori', 'alamat', 'deskripsi'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_service_request',
      description:
        'Siapkan link formulir layanan online untuk warga. Jangan kumpulkan data administrasi lengkap via chat.',
      parameters: {
        type: 'object',
        properties: {
          service_slug: {
            type: 'string',
            description: 'Slug layanan dari hasil get_service_info.',
          },
        },
        required: ['service_slug'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_history',
      description:
        'Ambil riwayat laporan dan permohonan layanan milik user yang sedang berbicara.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_status',
      description:
        'Cek status laporan atau layanan berdasarkan nomor referensi. Gunakan untuk LAP-xxx atau LAY-xxx.',
      parameters: {
        type: 'object',
        properties: {
          reference_number: {
            type: 'string',
            description: 'Nomor referensi laporan/layanan. Contoh: "LAP-20260101-001" atau "LAY-20260101-001".',
          },
        },
        required: ['reference_number'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_request',
      description:
        'Batalkan laporan atau layanan. Wajib minta konfirmasi user terlebih dahulu sebelum eksekusi.',
      parameters: {
        type: 'object',
        properties: {
          reference_number: {
            type: 'string',
            description: 'Nomor referensi laporan atau layanan.',
          },
          confirmation: {
            type: 'boolean',
            description: 'true jika user sudah mengonfirmasi pembatalan.',
          },
          cancel_reason: {
            type: 'string',
            description: 'Alasan pembatalan jika user menyebutkannya.',
          },
        },
        required: ['reference_number', 'confirmation'],
      },
    },
  },
];

export type AgentToolName =
  | 'get_village_profile'
  | 'get_service_info'
  | 'get_complaint_categories'
  | 'get_emergency_contacts'
  | 'search_knowledge'
  | 'search_documents'
  | 'create_complaint'
  | 'create_service_request'
  | 'get_my_history'
  | 'check_status'
  | 'cancel_request';
