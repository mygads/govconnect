# Sistem Layanan & Form Publik (Redesain)

Dokumen ini menggantikan konsep lama dan fokus pada **layanan administrasi** dengan **persyaratan dinamis** dan **form publik**.

## 🎯 Fitur Utama

### 1) Layanan Dinamis
- Admin dapat membuat **kategori layanan** dan **banyak layanan** di tiap kategori.
- Setiap layanan punya:
  - nama, deskripsi, kategori
  - mode pelayanan: **online**, **ambil di kantor**, atau **keduanya**
  - daftar **persyaratan** dinamis (file/field)

### 2) Persyaratan Dinamis
- Tipe input:
  - **File upload** (KTP, KK, foto, dsb)
  - **Text/textarea** (alamat, keterangan)
  - **Select/radio/date/number**

### 3) Form Publik
- URL: `govconnect.my.id/form/{slug-desa}/{slug-layanan}`
- Query `?user=628xxx` untuk auto-fill nomor WA.
- Setelah submit, warga mendapat **nomor layanan**.
- **Catatan**: pengisian data layanan hanya melalui form publik (bukan via WA).

### 4) Status & Riwayat
- Cek status via WA: “Cek status LAY-...”
- Riwayat layanan via WA.
- Update data layanan dilakukan melalui **link edit bertoken** (validasi nomor WA).
- Pembatalan layanan via WA wajib **konfirmasi** sebelum dibatalkan.

---

## 🔄 Flow Layanan (Ringkas)

### A) Info layanan → Form
```
1. Warga WA: “Syarat bikin KTP?”
2. AI jawab persyaratan + tanya mau diproses.
3. Jika ya → kirim link form publik.
```

### B) Submit Form → Nomor Layanan
```
1. Warga isi form dan upload berkas.
2. Case Service membuat service_request.
3. Sistem memberi nomor layanan.
4. Warga dapat cek status via WA.
```

---

## 🗄️ Skema Data (Case Service)

### ServiceCategory
- `id`, `village_id`, `name`, `description`, `is_active`

### Service
- `id`, `village_id`, `category_id`, `name`, `description`
- `slug`, `mode` (online|offline|both), `is_active`

### ServiceRequirement
- `id`, `service_id`, `label`, `field_type`, `is_required`
- `options_json` (untuk select/radio), `help_text`

### ServiceRequest
- `id`, `request_number`, `service_id`, `wa_user_id`
- `citizen_data_json`, `requirement_data_json`
- `status` (baru|proses|selesai|ditolak|dibatalkan)
- `created_at`, `updated_at`

---

## 🎨 Halaman Dashboard
- **Layanan**: CRUD kategori, layanan, persyaratan
- **Daftar Pelayanan**: list request, detail, ubah status
- **Detail Pelayanan**: catatan admin + upload dokumen hasil

---

## 📝 Contoh Data Layanan
**Kategori:** Layanan Administrasi Desa

**Layanan:** Keterangan Usaha
- Persyaratan: KTP, Foto Usaha

**Layanan:** Keterangan Tidak Mampu
- Persyaratan: KTP, KK, Terdaftar di DTKS (opsional)

**Layanan:** Surat Pengantar Pindah
- Persyaratan: KTP, KK, Data alamat tujuan

(Daftar lengkap mengikuti input admin.)

---

## 📌 Contoh Detail (Sesuai Permintaan)

### A. Layanan Administrasi Desa dan Kelurahan
1) Keterangan Usaha
- Persyaratan: KTP, Foto Usaha

2) Keterangan Tidak Mampu
- Persyaratan: KTP, KK, Terdaftar di DTKS (opsional)

3) Keterangan Kepemilikan Tanah BRI
- Persyaratan: KTP pemohon, SPPT, KTP atas nama yang tertera di SPPT

4) Surat Pengantar Pindah
- Persyaratan: KTP, KK, Data alamat tujuan pindah

5) Surat Beda Nama
- Persyaratan: KTP, Data pendukung yang membuktikan bahwa yang bersangkutan adalah orang yang sama

6) Rekomendasi BBM
- Persyaratan: Berita acara kelompok tani / berkas kelompok tani (KT) yang terdaftar, KTP, Persetujuan penyuluh

7) Keterangan Belum Menikah
- Persyaratan: KTP yang bersangkutan, KTP saksi, KK, Saksi: Imam dan Tokoh Masyarakat

8) Pengantar Ternak
- Persyaratan: KTP, Foto ternak

9) Keterangan Kematian
- Persyaratan: KTP yang meninggal, KTP saksi keluarga, Data waktu dan lokasi meninggal

10) Pengantar Nikah
- Persyaratan: KTP, KK

11) Keterangan Domisili
- Persyaratan: KTP

12) Kartu Identitas Anak (KIA)
- Persyaratan: KK, Akta Kelahiran
- Usia 0–5 tahun: tanpa foto
- Usia di atas 5 tahun: menggunakan foto
  - Tahun ganjil: latar merah
  - Tahun genap: latar biru
- Catatan: Waktu pengerjaan sekitar 10 menit (Pejabat Desa/Kelurahan berada di Kantor)

> Catatan: Saat ini scope layanan hanya untuk desa/kelurahan. Layanan tingkat kecamatan akan ditambahkan pada fase berikutnya.
