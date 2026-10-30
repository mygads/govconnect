/**
 * WhatsApp Flows — struktur dasar formulir laporan.
 *
 * STATUS: Struktur siap, butuh Meta approval.
 *
 * WhatsApp Flows memungkinkan formulir native di dalam chat WhatsApp.
 * Submit menghasilkan JSON yang siap dimasukkan ke database.
 *
 * Untuk produksi, Flow harus:
 * 1. Didaftarkan di Meta Business Manager (Flow JSON di-upload)
 * 2. Mendapatkan approval dari Meta (review 1-3 hari kerja)
 * 3. Flow ID yang disetujui dikonfigurasi per desa di dashboard
 *
 * Referensi: https://developers.facebook.com/docs/whatsapp/flows
 *
 * R1 (arsitektur-final §5.5): "Formulir laporan = WhatsApp Flows
 * (submit = JSON siap-DB) + fallback teks (Flow hanya mobile)."
 */

export interface FlowField {
  /** Unique field name — menjadi key di JSON submit. */
  name: string;
  /** Label yang tampil di formulir. */
  label: string;
  /** Tipe input. */
  type: 'text' | 'textarea' | 'dropdown' | 'radio' | 'date' | 'photo';
  /** Wajib diisi. */
  required: boolean;
  /** Placeholder / hint. */
  placeholder?: string;
  /** Opsi untuk dropdown/radio. */
  options?: Array<{ id: string; title: string }>;
  /** Validasi tambahan. */
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
}

export interface FlowDefinition {
  /** Nama flow (misal: 'laporan_kerusakan_jalan'). */
  name: string;
  /** Judul yang tampil di header flow. */
  title: string;
  /** Daftar field formulir. */
  fields: FlowField[];
  /** Endpoint webhook untuk menerima submit (opsional, bisa via channel-service). */
  dataChannelUri?: string;
}

/**
 * Flow: Formulir laporan kerusakan infrastruktur.
 * Dipakai saat warga memilih kategori infrastruktur dari triage list.
 */
export const FLOW_LAPORAN_INFRASTRUKTUR: FlowDefinition = {
  name: 'laporan_infrastruktur',
  title: 'Formulir Laporan Infrastruktur',
  fields: [
    {
      name: 'kategori',
      label: 'Jenis Kerusakan',
      type: 'dropdown',
      required: true,
      options: [
        { id: 'jalan_rusak', title: 'Jalan rusak / berlubang' },
        { id: 'jembatan_rusak', title: 'Jembatan rusak' },
        { id: 'drainase_mampet', title: 'Drainase mampet / banjir' },
        { id: 'lampu_mati', title: 'Lampu jalan mati' },
        { id: 'air_bersih', title: 'Air bersih bermasalah' },
        { id: 'sampah', title: 'Sampah menumpuk' },
      ],
    },
    {
      name: 'lokasi',
      label: 'Lokasi Kejadian',
      type: 'text',
      required: true,
      placeholder: 'Contoh: Jl. Merdeka RT 03, depan balai desa',
      validation: { minLength: 5, maxLength: 200 },
    },
    {
      name: 'deskripsi',
      label: 'Deskripsi Kerusakan',
      type: 'textarea',
      required: true,
      placeholder: 'Jelaskan kondisi kerusakan sedetail mungkin',
      validation: { minLength: 10, maxLength: 1000 },
    },
    {
      name: 'sejak_kapan',
      label: 'Sejak Kapan Terjadi',
      type: 'dropdown',
      required: false,
      options: [
        { id: 'baru', title: 'Baru hari ini' },
        { id: 'minggu_ini', title: 'Minggu ini' },
        { id: 'bulan_ini', title: 'Bulan ini' },
        { id: 'lebih_lama', title: 'Lebih dari sebulan' },
      ],
    },
    {
      name: 'ada_korban',
      label: 'Ada Korban?',
      type: 'radio',
      required: true,
      options: [
        { id: 'tidak', title: 'Tidak ada' },
        { id: 'ya_ringan', title: 'Ya, luka ringan' },
        { id: 'ya_berat', title: 'Ya, luka berat' },
      ],
    },
    {
      name: 'foto',
      label: 'Foto Kerusakan (opsional)',
      type: 'photo',
      required: false,
    },
  ],
};

/**
 * Flow: Formulir permohonan surat administrasi.
 */
export const FLOW_PERMOHONAN_SURAT: FlowDefinition = {
  name: 'permohonan_surat',
  title: 'Formulir Permohonan Surat',
  fields: [
    {
      name: 'jenis_surat',
      label: 'Jenis Surat',
      type: 'dropdown',
      required: true,
      options: [
        { id: 'domisili', title: 'Surat Keterangan Domisili' },
        { id: 'usaha', title: 'Surat Keterangan Usaha' },
        { id: 'tidak_mampu', title: 'Surat Keterangan Tidak Mampu' },
        { id: 'kelahiran', title: 'Surat Keterangan Lahir' },
        { id: 'kematian', title: 'Surat Keterangan Kematian' },
      ],
    },
    {
      name: 'nama_lengkap',
      label: 'Nama Lengkap',
      type: 'text',
      required: true,
      validation: { minLength: 3, maxLength: 100 },
    },
    {
      name: 'keperluan',
      label: 'Keperluan',
      type: 'textarea',
      required: true,
      placeholder: 'Contoh: Untuk pengajuan KUR bank',
      validation: { minLength: 5, maxLength: 500 },
    },
  ],
};

/**
 * Generate Flow JSON sesuai spesifikasi Meta.
 * Output ini yang di-upload ke Meta Business Manager untuk approval.
 */
export function toMetaFlowJson(flow: FlowDefinition): object {
  return {
    version: '5.0',
    screens: [
      {
        id: 'FORM',
        title: flow.title,
        data: {},
        layout: {
          type: 'SingleColumnLayout',
          children: flow.fields.map((f) => ({
            type: 'Form',
            name: 'form',
            children: [fieldToMetaComponent(f)],
          })),
        },
      },
      {
        id: 'SUCCESS',
        title: 'Berhasil',
        data: {
          extension_message_response: {
            params: { flow_token: '${data.flow_token}' },
          },
        },
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              type: 'TextHeading',
              text: 'Laporan Terkirim ✅',
            },
            {
              type: 'TextBody',
              text: 'Terima kasih, laporan Anda sudah kami terima dan akan ditindaklanjuti oleh perangkat desa.',
            },
            {
              type: 'Footer',
              label: 'Selesai',
              'on-click-action': {
                name: 'complete',
                payload: {},
              },
            },
          ],
        },
      },
    ],
  };
}

function fieldToMetaComponent(field: FlowField): object {
  const base = {
    name: field.name,
    label: field.label,
    required: field.required,
  };
  switch (field.type) {
    case 'dropdown':
      return {
        ...base,
        type: 'Dropdown',
        'data-source': field.options?.map((o) => ({ id: o.id, title: o.title })) ?? [],
      };
    case 'radio':
      return {
        ...base,
        type: 'RadioButtonsGroup',
        'data-source': field.options?.map((o) => ({ id: o.id, title: o.title })) ?? [],
      };
    case 'textarea':
      return { ...base, type: 'TextArea', placeholder: field.placeholder };
    case 'date':
      return { ...base, type: 'CalendarPicker' };
    case 'photo':
      return { ...base, type: 'PhotoPicker' };
    default:
      return { ...base, type: 'TextInput', placeholder: field.placeholder };
  }
}

/**
 * Parse hasil submit Flow menjadi slot yang siap dipakai pipeline.
 * Flow submit = JSON dengan key = field.name.
 */
export function parseFlowSubmit(
  flowName: string,
  data: Record<string, unknown>,
): Record<string, string> {
  const slots: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && value.trim()) {
      slots[key] = value.trim();
    }
  }
  slots['_flow_name'] = flowName;
  slots['_flow_submitted'] = 'true';
  return slots;
}

/** Daftar semua flow yang tersedia. */
export const AVAILABLE_FLOWS: FlowDefinition[] = [
  FLOW_LAPORAN_INFRASTRUKTUR,
  FLOW_PERMOHONAN_SURAT,
];

/** Cari flow berdasarkan nama. */
export function getFlowByName(name: string): FlowDefinition | null {
  return AVAILABLE_FLOWS.find((f) => f.name === name) ?? null;
}
