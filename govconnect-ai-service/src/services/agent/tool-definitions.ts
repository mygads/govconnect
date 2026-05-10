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
    strict?: boolean;
    parameters: Record<string, unknown>;
  };
}

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_village_profile',
      strict: true,
      description:
        'Profil desa resmi: nama, alamat kantor, jam operasional, kontak kantor, dan Google Maps. ' +
        'Gunakan untuk pertanyaan alamat, jam buka, lokasi, atau kontak kantor desa.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_service_info',
      strict: true,
      description:
        'Detail layanan administrasi: daftar layanan aktif, persyaratan, dan mode layanan. ' +
        'Gunakan untuk menjelaskan syarat dan kesiapan layanan sebelum mengirim link formulir. ' +
        'Gunakan untuk pertanyaan syarat, biaya, proses, dokumen, surat, atau layanan kependudukan. ' +
        'Jika service_name kosong, tool boleh dipakai untuk menampilkan layanan aktif yang tersedia.',
      parameters: {
        type: 'object',
        properties: {
          service_name: {
            type: ['string', 'null'],
            description: 'Nama layanan spesifik jika user menanyakan layanan tertentu. Contoh: "KTP", "SKTM", "surat pindah".',
          },
        },
        required: ['service_name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_complaint_categories',
      strict: true,
      description:
        'Daftar kategori pengaduan resmi yang tersedia di desa ini, termasuk penanda kategori darurat bila ada.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_emergency_contacts',
      strict: true,
      description:
        'Nomor darurat dan kontak penting publik seperti pemadam, ambulans, polisi, puskesmas, atau fasilitas bantuan cepat lainnya. ' +
        'Gunakan HANYA jika user melaporkan situasi darurat yang sedang berlangsung, bukan saat user hanya bertanya "ada nomor X?".',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_important_contact',
      strict: true,
      description:
        'Cari nomor kontak penting berdasarkan nama entitas, peran, atau kategori. ' +
        'Gunakan tool ini untuk semua pertanyaan DIREKTORI seperti "ada nomor kepala desa?", "nomor puskesmas solo", "nomor damkar", "nomor polsek", "nomor kecamatan", "nomor RT". ' +
        'Ini BUKAN untuk situasi darurat yang sedang berlangsung. Untuk darurat aktif gunakan get_emergency_contacts. ' +
        'Tool ini mengembalikan kontak paling relevan dari database resmi desa. Jangan mengarang nomor jika tool tidak menemukan hasil.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Pertanyaan atau nama entitas yang dicari. Contoh: "kepala desa", "puskesmas solo", "damkar", "polsek", "kecamatan", "nomor RT 03".',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      strict: true,
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
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_documents',
      strict: true,
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
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_user_memory',
      strict: true,
      description:
        'Cari memori internal lintas sesi tentang user yang sedang berbicara. ' +
        'Gunakan hanya untuk konteks personal user, interaksi sebelumnya, alamat yang pernah dipakai, riwayat perubahan, atau preferensi yang relevan. ' +
        'Jangan gunakan untuk fakta resmi desa.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Apa yang ingin diingat kembali tentang user. Contoh: "alamat terakhir user", "laporan terakhir user", "preferensi gaya bahasa user".',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_complaint',
      strict: true,
      description:
        'Buat pengaduan infrastruktur. Wajib ada kategori, alamat, dan deskripsi. ' +
        'Nama pelapor dan nomor telepon bersifat opsional. Untuk kanal WhatsApp jangan meminta nomor HP lagi jika masalah sudah jelas. Jangan bilang laporan berhasil dibuat jika tool ini gagal.',
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
            type: ['string', 'null'],
            description: 'RT/RW lokasi bila tersedia.',
          },
          nama_pelapor: {
            type: ['string', 'null'],
            description: 'Nama lengkap pelapor bila user menyebutkannya di chat.',
          },
          no_hp: {
            type: ['string', 'null'],
            description: 'Nomor HP pelapor, terutama untuk kanal webchat.',
          },
        },
        required: ['kategori', 'alamat', 'deskripsi', 'rt_rw', 'nama_pelapor', 'no_hp'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_service_request',
      strict: true,
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
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_complaint',
      strict: true,
      description:
        'Perbarui laporan pengaduan milik user. Gunakan jika user ingin menambah detail, mengubah alamat, atau memperbarui RT/RW pada laporan yang masih aktif.',
      parameters: {
        type: 'object',
        properties: {
          reference_number: {
            type: 'string',
            description: 'Nomor laporan. Contoh: "LAP-20260101-001".',
          },
          alamat: {
            type: ['string', 'null'],
            description: 'Alamat terbaru jika user ingin memperbarui lokasi.',
          },
          deskripsi: {
            type: ['string', 'null'],
            description: 'Keterangan tambahan atau revisi deskripsi laporan.',
          },
          rt_rw: {
            type: ['string', 'null'],
            description: 'RT/RW terbaru bila user menyebutkannya.',
          },
        },
        required: ['reference_number', 'alamat', 'deskripsi', 'rt_rw'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_service_request_edit_link',
      strict: true,
      description:
        'Siapkan link edit aman untuk permohonan layanan milik user agar perubahan data dilakukan di website, bukan lewat chat.',
      parameters: {
        type: 'object',
        properties: {
          reference_number: {
            type: 'string',
            description: 'Nomor permohonan layanan. Contoh: "LAY-20260101-001".',
          },
        },
        required: ['reference_number'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_history',
      strict: true,
      description:
        'Ambil riwayat laporan dan permohonan layanan milik user yang sedang berbicara.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_status',
      strict: true,
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
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_request',
      strict: true,
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
            type: ['string', 'null'],
            description: 'Alasan pembatalan jika user menyebutkannya.',
          },
        },
        required: ['reference_number', 'confirmation', 'cancel_reason'],
        additionalProperties: false,
      },
    },
  },
];

export type AgentToolName =
  | 'get_village_profile'
  | 'get_service_info'
  | 'get_complaint_categories'
  | 'get_emergency_contacts'
  | 'get_important_contact'
  | 'search_knowledge'
  | 'search_documents'
  | 'search_user_memory'
  | 'create_complaint'
  | 'create_service_request'
  | 'update_complaint'
  | 'get_service_request_edit_link'
  | 'get_my_history'
  | 'check_status'
  | 'cancel_request';
