/**
 * R10 — Adapter SID/OpenSID desa (Sistem Informasi Desa).
 *
 * BATAS JUJUR (arsitektur-final §6, v5 threat model):
 * - TIDAK ADA API SID/OpenSID pusat yang bisa dipanggil GovConnect.
 *   Setiap desa menjalankan SID/OpenSID sendiri (sering on-premise di kantor
 *   desa) dengan kredensial berbeda-beda.
 * - Modul ini MENDEFINISIKAN interface + adapter "unconfigured" yang menolak
 *   secara eksplisit. Integrasi nyata memerlukan, per desa:
 *     1. URL endpoint API SID/OpenSID desa tersebut,
 *     2. kredensial (API key / token) yang disimpan di Secure Vault,
 *     3. persetujuan tertulis perangkat desa (data kependudukan = data pribadi).
 * - JANGAN PERNAH klaim "terverifikasi via SID" bila adapter belum dikonfigurasi.
 * - Verifikasi identitas L2 tetap mengandalkan verifikasi administratif manual
 *   oleh perangkat desa (lihat identity-ladder.ts + ktp-verifications.routes.ts).
 */

export interface SidResidentLookup {
  /** NIK cocok dengan data SID (tanpa mengembalikan data pribadi penuh). */
  nikFound: boolean;
  /** Nama samaran/inisial bila ada (opsional, tergantung izin desa). */
  nameHint?: string;
  /** Apakah NIK terdaftar sebagai warga desa ini. */
  isResident?: boolean;
}

export interface SidAdapter {
  /** Nama adapter, mis. 'opensid-rest', 'sid-custom'. */
  readonly name: string;
  /** True bila adapter dikonfigurasi untuk desa ini (punya URL + kredensial). */
  isConfigured(villageId: string): Promise<boolean>;
  /**
   * Lookup NIK (dalam bentuk token vault — adapter TIDAK menerima plaintext).
   * Implementasi nyata mendekripsi token via PII vault di dalam boundary
   * aman, memanggil API SID desa, lalu membuang plaintext.
   */
  lookupByNikToken(villageId: string, nikToken: string): Promise<SidResidentLookup>;
}

/**
 * Adapter default: tidak terkonfigurasi. lookupByNikToken() selalu melempar
 * SidNotConfiguredError — never silent, never fake-verified.
 */
export class SidNotConfiguredError extends Error {
  constructor(villageId: string) {
    super(
      `SID/OpenSID belum dikonfigurasi untuk desa ${villageId}. ` +
      `Integrasi memerlukan URL API + kredensial desa (disimpan di Secure Vault) ` +
      `dan persetujuan perangkat desa. Verifikasi L2 tetap via jalur administratif manual.`,
    );
    this.name = 'SidNotConfiguredError';
  }
}

export class UnconfiguredSidAdapter implements SidAdapter {
  readonly name = 'unconfigured';

  async isConfigured(_villageId: string): Promise<boolean> {
    return false;
  }

  async lookupByNikToken(villageId: string, _nikToken: string): Promise<SidResidentLookup> {
    throw new SidNotConfiguredError(villageId);
  }
}

/**
 * Registry per-desa. Hari ini hanya berisi adapter unconfigured.
 * Untuk menambah desa terintegrasi di masa depan:
 *   registerSidAdapter(villageId, new OpenSidRestAdapter({ baseUrl, getApiKey }))
 * dengan kredensial diambil dari Secure Vault (bukan env/plaintext).
 */
const registry = new Map<string, SidAdapter>();

export function registerSidAdapter(villageId: string, adapter: SidAdapter): void {
  registry.set(villageId, adapter);
}

export function getSidAdapter(villageId: string): SidAdapter {
  return registry.get(villageId) ?? new UnconfiguredSidAdapter();
}

/** Helper jujur untuk admin UI: "apakah desa ini terhubung ke SID?". */
export async function isSidConfigured(villageId: string): Promise<boolean> {
  return getSidAdapter(villageId).isConfigured(villageId);
}
