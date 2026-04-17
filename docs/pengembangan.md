
## 💡 Ide Fitur Pengembangan ke Depan

### Fitur 1: Dukungan Bahasa Daerah

| | |
|---|---|
| **Deskripsi** | Tambahkan dukungan bahasa daerah (Sunda, Jawa, Bugis, dll.) di samping Bahasa Indonesia. Banyak warga desa, terutama lansia, lebih nyaman berkomunikasi dalam bahasa ibu mereka. |
| **Implementasi** | Deteksi bahasa di lapisan NLU. Manfaatkan kemampuan multibahasa Gemini dengan *system prompt* khusus bahasa. Simpan preferensi bahasa yang terdeteksi di profil pengguna. |
| **Dampak** | Meningkatkan aksesibilitas secara dramatis untuk sasaran utama sistem (warga desa). |

### Fitur 2: Antrian Pesan Persisten (*Offline Queue*)

| | |
|---|---|
| **Deskripsi** | Implementasikan antrian pesan persisten menggunakan **PostgreSQL** (tabel antrian) agar tidak ada pesan yang hilang meski terjadi gangguan layanan penuh. |
| **Implementasi** | Channel service menulis setiap pesan masuk ke tabel antrian PostgreSQL sebelum mencoba pemrosesan AI. Konsumer menguras antrian. Pesan yang gagal tetap di antrian dengan *backoff* eksponensial. |
| **Dampak** | Jaminan *zero message loss* — kritis untuk layanan pemerintah di mana laporan pengaduan yang hilang dapat berdampak nyata bagi warga. |

### Fitur 3: Dashboard Analitik Percakapan

| | |
|---|---|
| **Deskripsi** | Bangun *dashboard* analitik *real-time*: tingkat penyelesaian percakapan, waktu resolusi rata-rata, titik kegagalan umum, sinyal kepuasan pengguna, tren celah *knowledge base*. |
| **Implementasi** | Perluas `ai-analytics.service.ts` untuk melacak hasil percakapan. Tambahkan pertanyaan "apakah ini membantu?" setelah resolusi. Agregasikan data di DB yang sudah ada. |
| **Dampak** | Memungkinkan peningkatan berbasis data untuk AI dan layanan desa. |





### Fitur 6: Peningkatan Serah Terima ke Admin (*Human Handover*)

| | |
|---|---|
| **Deskripsi** | Saat admin mengambil alih percakapan, sediakan: ringkasan percakapan hasil AI, respons yang disarankan, konteks profil warga, dan pengaduan terkait sebelumnya. |
| **Implementasi** | Saat *handover* dipicu, panggil AI service untuk ringkasan percakapan. Tampilkan pengaduan terkait dari case service. Isi otomatis template respons yang disarankan. |
| **Dampak** | Mengurangi waktu respons admin dan meningkatkan kualitas respons manual. |




### Fitur 9: Anggaran Token per Desa dengan Kontrol Biaya

| | |
|---|---|
| **Deskripsi** | Izinkan admin menetapkan anggaran token bulanan per desa. Saat desa mendekati anggaran, notifikasi admin dan beralih ke model yang lebih murah. |
| **Implementasi** | Periksa total token bulanan per desa dari `token-usage.service.ts`. Pada 80% anggaran, alihkan ke model termurah. Pada 100%, kirim *alert* admin dan gunakan respons *fallback*. |
| **Dampak** | Mencegah pembengkakan biaya tak terduga untuk desa dengan anggaran terbatas. |


### Fitur 10: Enkripsi Data Sensitif *End-to-End*

| | |
|---|---|
| **Deskripsi** | Enkripsi data pengaduan sensitif (NIK, alamat, detail pribadi) dari sisi klien hingga database, sehingga tidak pernah tersimpan *plain text* di service perantara mana pun. |
| **Implementasi** | Buat kunci enkripsi per desa. Enkripsi *field* PII sebelum disimpan di DB case service. AI service hanya memproses PII pesan saat ini (transit, bukan *at rest*). Dekripsi hanya saat admin melihat pengaduan. |
| **Relevansi Hukum** | Kepatuhan penuh UU PDP. Melindungi data bahkan jika database dikompromikan. |
