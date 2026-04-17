/**
 * Agent Tool Definitions — OpenAI-compatible function calling schema.
 *
 * Each tool wraps an existing service function and exposes it as
 * a deterministic, structured API that the LLM agent can invoke.
 *
 * Fase 2.1: 9 tools covering facts, retrieval, and actions.
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
  // ─── 1. Deterministic fact tools ───
  {
    type: 'function',
    function: {
      name: 'get_office_profile',
      description:
        'Ambil profil kantor desa/kelurahan: nama, alamat, jam operasional, link Google Maps. ' +
        'Gunakan untuk menjawab pertanyaan tentang alamat, jam buka, lokasi kantor.',
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
      name: 'get_service_catalog',
      description:
        'Ambil daftar layanan yang tersedia di kantor desa/kelurahan. ' +
        'Gunakan untuk menjawab pertanyaan tentang layanan apa saja yang tersedia, persyaratan, atau prosedur.',
      parameters: {
        type: 'object',
        properties: {
          service_keyword: {
            type: 'string',
            description: 'Kata kunci layanan yang dicari (opsional). Contoh: "surat keterangan", "KTP".',
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
        'Ambil daftar kategori pengaduan/laporan yang tersedia. ' +
        'Gunakan untuk mengetahui jenis-jenis laporan yang bisa dibuat warga. ' +
        'Hasil termasuk flag is_urgent — jika true, laporan kategori tersebut akan memicu NOTIFIKASI DARURAT ke petugas secara otomatis.',
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
      name: 'get_important_contacts',
      description:
        'Ambil daftar kontak penting: nomor darurat, kontak pejabat desa, fasilitas umum. ' +
        'Gunakan untuk menjawab pertanyaan tentang nomor telepon, kontak, atau informasi darurat.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Kategori kontak (opsional). Contoh: "darurat", "pejabat", "kesehatan".',
          },
        },
        required: [],
      },
    },
  },

  // ─── 2. Knowledge retrieval tool ───
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description:
        'Cari informasi di basis pengetahuan desa (SOP, FAQ, dokumen, peraturan). ' +
        'Gunakan untuk pertanyaan yang BUKAN fakta sederhana (alamat/jam/kontak/layanan), ' +
        'tetapi membutuhkan informasi dari dokumen atau pengetahuan yang lebih detail. ' +
        'Contoh: prosedur pembuatan surat, syarat nikah, aturan RT/RW.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Pertanyaan atau topik yang ingin dicari. Tulis dalam bahasa Indonesia yang jelas.',
          },
          categories: {
            type: 'array',
            items: { type: 'string' },
            description: 'Kategori pengetahuan (opsional): "informasi_umum", "layanan", "prosedur", "jadwal", "kontak", "faq".',
          },
        },
        required: ['query'],
      },
    },
  },

  // ─── 3. Status check tools ───
  {
    type: 'function',
    function: {
      name: 'check_complaint_status',
      description:
        'Cek status laporan/pengaduan warga berdasarkan nomor laporan (LAP-xxx). ' +
        'Gunakan saat user menanyakan status laporan yang sudah dibuat.',
      parameters: {
        type: 'object',
        properties: {
          complaint_id: {
            type: 'string',
            description: 'Nomor laporan. Contoh: "LAP-20250115-001".',
          },
        },
        required: ['complaint_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_service_request_status',
      description:
        'Cek status permohonan layanan berdasarkan nomor permohonan. ' +
        'Gunakan saat user menanyakan status permohonan surat/layanan.',
      parameters: {
        type: 'object',
        properties: {
          request_number: {
            type: 'string',
            description: 'Nomor permohonan layanan.',
          },
        },
        required: ['request_number'],
      },
    },
  },

  // ─── 4. Action tools ───
  {
    type: 'function',
    function: {
      name: 'create_complaint',
      description:
        'Buat laporan/pengaduan baru. Gunakan HANYA setelah user memberikan informasi lengkap: ' +
        'kategori, deskripsi masalah, dan alamat lokasi. ' +
        'Jika informasi belum lengkap, tanyakan dulu ke user — JANGAN langsung panggil tool ini. ' +
        'PENTING: Untuk kategori darurat (kebakaran, banjir, kecelakaan, dll), sistem akan otomatis ' +
        'mengirim notifikasi darurat ke petugas dan menyertakan kontak penting dalam respons.',
      parameters: {
        type: 'object',
        properties: {
          kategori: {
            type: 'string',
            description: 'Kategori laporan. Contoh: "jalan_rusak", "lampu_mati", "sampah", "drainase".',
          },
          deskripsi: {
            type: 'string',
            description: 'Deskripsi detail masalah yang dilaporkan.',
          },
          alamat: {
            type: 'string',
            description: 'Alamat lokasi masalah.',
          },
          rt_rw: {
            type: 'string',
            description: 'RT/RW lokasi (opsional). Contoh: "RT 03 RW 05".',
          },
        },
        required: ['kategori', 'deskripsi', 'alamat'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_service_request',
      description:
        'Buat permohonan layanan baru (surat keterangan, surat pengantar, dll). ' +
        'Gunakan HANYA setelah user memberikan informasi lengkap tentang jenis layanan dan data diri. ' +
        'Jika informasi belum lengkap, tanyakan dulu — JANGAN langsung panggil tool ini.',
      parameters: {
        type: 'object',
        properties: {
          service_slug: {
            type: 'string',
            description: 'Slug layanan yang diminta. Didapat dari get_service_catalog.',
          },
          citizen_data: {
            type: 'object',
            description: 'Data diri pemohon: nama_lengkap, nik, alamat, no_hp.',
            properties: {
              nama_lengkap: { type: 'string', description: 'Nama lengkap pemohon.' },
              nik: { type: 'string', description: 'NIK pemohon (16 digit).' },
              alamat: { type: 'string', description: 'Alamat pemohon.' },
              no_hp: { type: 'string', description: 'Nomor HP pemohon.' },
            },
            required: ['nama_lengkap'],
          },
        },
        required: ['service_slug', 'citizen_data'],
      },
    },
  },

  // ─── 5. Cancel / Update / History tools ───
  {
    type: 'function',
    function: {
      name: 'cancel_complaint',
      description:
        'Batalkan laporan/pengaduan yang sudah dibuat. Gunakan saat user ingin membatalkan laporan mereka. ' +
        'Butuh nomor laporan (LAP-xxx). Tanyakan alasan pembatalan jika user belum menyebutkan.',
      parameters: {
        type: 'object',
        properties: {
          complaint_id: {
            type: 'string',
            description: 'Nomor laporan yang ingin dibatalkan. Contoh: "LAP-20250115-001".',
          },
          cancel_reason: {
            type: 'string',
            description: 'Alasan pembatalan (opsional tapi disarankan).',
          },
        },
        required: ['complaint_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_service_request',
      description:
        'Batalkan permohonan layanan yang sudah dibuat. Gunakan saat user ingin membatalkan permohonan surat/layanan mereka. ' +
        'Butuh nomor permohonan.',
      parameters: {
        type: 'object',
        properties: {
          request_number: {
            type: 'string',
            description: 'Nomor permohonan layanan yang ingin dibatalkan.',
          },
          cancel_reason: {
            type: 'string',
            description: 'Alasan pembatalan (opsional tapi disarankan).',
          },
        },
        required: ['request_number'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_complaint',
      description:
        'Perbarui data laporan/pengaduan yang sudah dibuat. User bisa mengubah alamat, deskripsi, atau RT/RW. ' +
        'Butuh nomor laporan (LAP-xxx). Hanya bisa diubah jika status masih baru/open.',
      parameters: {
        type: 'object',
        properties: {
          complaint_id: {
            type: 'string',
            description: 'Nomor laporan yang ingin diperbarui. Contoh: "LAP-20250115-001".',
          },
          alamat: {
            type: 'string',
            description: 'Alamat baru (opsional).',
          },
          deskripsi: {
            type: 'string',
            description: 'Deskripsi baru (opsional).',
          },
          rt_rw: {
            type: 'string',
            description: 'RT/RW baru (opsional).',
          },
        },
        required: ['complaint_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_history',
      description:
        'Ambil riwayat semua laporan dan permohonan layanan milik user. ' +
        'Gunakan saat user bertanya "riwayat saya", "laporan saya", "apa saja yang pernah saya laporkan".',
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
      name: 'get_service_requirements',
      description:
        'Ambil persyaratan/formulir yang dibutuhkan untuk layanan tertentu. ' +
        'Gunakan saat user bertanya "apa saja syaratnya", "dokumen apa yang perlu dibawa". ' +
        'Butuh slug layanan dari get_service_catalog.',
      parameters: {
        type: 'object',
        properties: {
          service_slug: {
            type: 'string',
            description: 'Slug layanan. Didapat dari get_service_catalog.',
          },
        },
        required: ['service_slug'],
      },
    },
  },
];

/** Tool name union type for type safety */
export type AgentToolName =
  | 'get_office_profile'
  | 'get_service_catalog'
  | 'get_complaint_categories'
  | 'get_important_contacts'
  | 'search_knowledge'
  | 'check_complaint_status'
  | 'check_service_request_status'
  | 'create_complaint'
  | 'create_service_request'
  | 'cancel_complaint'
  | 'cancel_service_request'
  | 'update_complaint'
  | 'get_my_history'
  | 'get_service_requirements';
