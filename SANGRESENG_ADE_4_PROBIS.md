# Identifikasi 4 Proses Bisnis Pelayanan Publik Desa Sangreseng Ade

## Tujuan Dokumen
Dokumen ini disusun sebagai draft identifikasi proses bisnis pelayanan publik Desa Sangreseng Ade yang dapat dipakai sebagai bahan awal Bab 1–2. Fokus utama dokumen ini adalah **proses bisnis existing/awal** sebelum ada GovConnect, yaitu ketika pelayanan masih berjalan secara manual, terpisah, dan belum terintegrasi dalam satu sistem.

Di sisi lain, repositori GovConnect dipakai sebagai **acuan analitis** untuk memastikan bahwa proses bisnis yang dipilih memang realistis, relevan dengan pelayanan publik desa, dan memiliki arah digitalisasi yang jelas.

---

## Batasan dan Asumsi Analisis
Agar analisis ini tidak melampaui fakta yang tersedia, ada beberapa batasan yang digunakan:

1. **Proses bisnis awal/existing** pada dokumen ini merujuk pada kondisi sebelum GovConnect digunakan, yaitu saat pelayanan masih dilakukan secara manual atau semi-manual.
2. Analisis ini **belum menggantikan hasil wawancara lapangan**. Karena itu, beberapa narasi proses awal ditulis sebagai proses yang *paling masuk akal* berdasarkan konteks pelayanan desa, diskusi tim, dan arah solusi GovConnect.
3. GovConnect digunakan sebagai **referensi proses target / arah digitalisasi**, bukan sebagai bukti bahwa seluruh proses manual di Sangreseng Ade sudah persis seperti yang ada di aplikasi.
4. Beberapa layanan administrasi desa dapat melibatkan instansi lanjutan seperti **kecamatan, Dukcapil, atau unit lain di luar desa**. Karena itu, desa dalam konteks ini lebih tepat diposisikan sebagai **front office pelayanan publik** dan penghubung proses administrasi warga.
5. Untuk menjaga ketepatan akademik, proses seperti **damkar, polisi, ambulans, atau respons darurat lintas instansi** tidak dijadikan fokus utama, karena secara kelembagaan proses tersebut tidak sepenuhnya berada dalam kendali desa.

---

## Dasar Pemilihan 4 Proses Bisnis
Berdasarkan analisis terhadap GovConnect dan konteks pelayanan publik desa, terdapat beberapa domain proses yang tampak kuat dan konsisten, yaitu:

- pencarian informasi/pengetahuan layanan,
- pelayanan administrasi desa,
- pengaduan warga,
- serta pemantauan status proses.

Dari domain tersebut, dipilih **4 proses bisnis** yang paling layak dijadikan objek pemodelan karena:

1. relevan langsung dengan pelayanan publik di tingkat desa,
2. cukup berbeda satu sama lain sehingga bisa dibagi ke 4 anggota tim,
3. masih masuk akal untuk dijelaskan sebagai proses manual sebelum ada sistem,
4. punya dukungan kuat dari arah solusi GovConnect,
5. tidak terlalu bergantung pada instansi eksternal sebagai pemilik utama proses.

Empat proses bisnis yang direkomendasikan adalah:

1. **Pencarian informasi layanan dan persyaratan administrasi**
2. **Pengajuan layanan administrasi/surat oleh warga**
3. **Penyampaian pengaduan warga terkait masalah publik desa**
4. **Pelacakan status permohonan atau pengaduan oleh warga**

---

## Acuan Singkat dari GovConnect
Secara umum, GovConnect adalah sistem layanan desa multi-service yang mencakup dashboard admin, AI service, channel service, case service, dan notification service. Dari struktur sistemnya, terlihat bahwa GovConnect memang diarahkan untuk mendukung alur pelayanan publik desa, terutama pada:

- tanya jawab/informasi warga,
- informasi layanan dan persyaratan,
- pengajuan permohonan layanan,
- pengaduan warga,
- serta pengecekan status proses.

Selain itu, data seed Sangreseng Ade di GovConnect menunjukkan contoh layanan yang memang relevan dengan pelayanan administrasi desa, seperti:

- Surat Pengantar KTP,
- Surat Pengantar Nikah,
- Keterangan Domisili,
- Keterangan Usaha,
- Keterangan Tidak Mampu,
- Kartu Identitas Anak (KIA),
- Perekaman KTP,
- Akta Lahir.

Artinya, layanan yang dipilih dalam dokumen ini tidak dibuat secara abstrak, tetapi masih punya kaitan langsung dengan objek Sangreseng Ade yang sedang dianalisis.

---

# Empat Proses Bisnis yang Direkomendasikan

## 1. Pencarian Informasi Layanan dan Persyaratan Administrasi

### Definisi Singkat
Proses bisnis ini menggambarkan aktivitas warga ketika membutuhkan informasi mengenai jenis layanan, persyaratan dokumen, alur pengurusan, biaya, dan estimasi penyelesaian.

### Tujuan Proses
Memberikan informasi awal kepada warga agar mereka memahami layanan yang tersedia dan menyiapkan dokumen yang dibutuhkan sebelum datang atau mengajukan permohonan.

### Aktor Utama
- Warga
- Perangkat desa / petugas pelayanan
- Ketua RT/RW (dalam kondisi tertentu sebagai sumber informasi awal)

### Input
- Pertanyaan warga terkait suatu layanan
- Identitas kebutuhan layanan, misalnya kebutuhan KTP, domisili, surat usaha, atau surat pengantar nikah

### Output
- Informasi jenis layanan
- Daftar persyaratan
- Penjelasan cara pengurusan
- Arahan apakah layanan diproses di desa atau dilanjutkan ke instansi lain

### Narasi Proses Bisnis Awal/Existing
Berdasarkan konteks pelayanan desa, diskusi tim, dan arah solusi GovConnect, proses awal yang paling masuk akal adalah sebagai berikut:

1. Warga menyadari bahwa ia membutuhkan suatu layanan administrasi.
2. Warga mencari informasi dengan bertanya langsung ke tetangga, RT/RW, perangkat desa, atau datang ke kantor desa.
3. Petugas desa menjelaskan secara lisan jenis layanan yang sesuai dan dokumen yang perlu dibawa.
4. Jika informasi belum lengkap, warga dapat diminta kembali di hari lain atau mencari tahu lagi ke pihak lain.
5. Warga mencatat sendiri persyaratan dan menyiapkan berkas secara mandiri.

### Ciri Permasalahan pada Proses Existing
- Informasi sangat bergantung pada siapa yang ditanya.
- Penjelasan bisa tidak seragam antarpetugas atau antarwarga.
- Warga perlu datang atau menghubungi secara manual.
- Ada potensi warga bolak-balik karena berkas yang dibawa belum lengkap.

### Referensi GovConnect / Arah As-Is–To-Be
GovConnect mendukung alur pencarian informasi layanan melalui mekanisme knowledge/Q&A dan pencarian informasi layanan. Sistem ini juga menunjukkan bahwa layanan-layanan administratif di Sangreseng Ade dapat dipetakan ke katalog layanan tertentu.

Secara konseptual, ini menunjukkan arah digitalisasi bahwa warga nantinya bisa:
- menanyakan syarat layanan melalui kanal digital,
- memperoleh jawaban yang lebih seragam,
- mengetahui dokumen yang harus disiapkan tanpa harus datang terlebih dahulu.

### Alasan Layak Dijadikan Objek BPMN
Proses ini sangat dekat dengan kebutuhan dasar warga dan mudah dimodelkan sebagai proses front-office pelayanan. Selain itu, proses ini juga menjadi pintu masuk bagi proses bisnis lain, terutama pengajuan layanan.

---

## 2. Pengajuan Layanan Administrasi/Surat oleh Warga

### Definisi Singkat
Proses bisnis ini menggambarkan aktivitas warga ketika mengajukan layanan administrasi desa, seperti surat pengantar KTP, surat pengantar nikah, keterangan domisili, keterangan usaha, atau surat keterangan tidak mampu.

### Tujuan Proses
Memfasilitasi warga agar dapat mengajukan permohonan layanan administrasi secara resmi kepada desa dengan memenuhi persyaratan yang berlaku.

### Aktor Utama
- Warga
- Petugas pelayanan desa
- Kepala urusan/petugas administrasi
- Kepala desa atau pejabat yang berwenang menandatangani (jika diperlukan)
- RT/RW sebagai pihak pemberi surat pengantar awal (pada beberapa layanan)

### Input
- Permohonan layanan dari warga
- Dokumen persyaratan, misalnya KTP, KK, surat pengantar RT/RW, data alamat, data usaha, atau dokumen pendukung lain

### Output
- Permohonan tercatat
- Berkas diverifikasi
- Surat/pengantar/permohonan diproses
- Dokumen layanan diterbitkan atau diteruskan ke instansi lanjutan

### Narasi Proses Bisnis Awal/Existing
Berdasarkan konteks pelayanan desa, diskusi tim, dan arah solusi GovConnect, proses awal yang paling masuk akal adalah:

1. Warga mengetahui layanan yang dibutuhkan.
2. Warga menyiapkan dokumen persyaratan berdasarkan informasi yang diperoleh.
3. Pada beberapa jenis layanan, warga lebih dulu meminta surat pengantar dari RT/RW.
4. Warga datang ke kantor desa dengan membawa berkas.
5. Petugas desa memeriksa kelengkapan dan kecocokan dokumen.
6. Jika berkas belum lengkap, warga diminta melengkapi dan datang kembali.
7. Jika berkas lengkap, petugas mencatat permohonan dan memproses dokumen.
8. Bila layanan membutuhkan tindak lanjut instansi lain, desa menyiapkan surat pengantar atau dokumen administrasi yang menjadi dasar proses berikutnya.
9. Warga menerima hasil layanan, surat pengantar, atau informasi lanjutan mengenai tahapan berikutnya.

### Ciri Permasalahan pada Proses Existing
- Pengajuan masih sangat bergantung pada tatap muka dan jam kerja kantor.
- Warga bisa bolak-balik karena persyaratan tidak lengkap.
- Dokumen fisik rawan tercecer atau tidak terdokumentasi dengan baik.
- Status proses tidak selalu transparan bagi warga.
- Jika melibatkan instansi lanjutan, proses menjadi lebih panjang dan terfragmentasi.

### Referensi GovConnect / Arah As-Is–To-Be
GovConnect menunjukkan bahwa layanan administratif desa dapat dipetakan ke formulir digital dan persyaratan terstruktur. Pada sisi konsep, sistem ini mendukung:
- daftar layanan yang jelas,
- form pengajuan,
- unggah dokumen,
- pencatatan permohonan,
- dan pelacakan proses lanjutan.

Untuk Sangreseng Ade, contoh layanan yang relevan dari data sistem mencakup Surat Pengantar KTP, Surat Pengantar Nikah, Keterangan Domisili, Keterangan Usaha, Keterangan Tidak Mampu, KIA, Perekaman KTP, dan Akta Lahir.

### Alasan Layak Dijadikan Objek BPMN
Ini adalah proses bisnis inti pelayanan publik desa karena langsung menghasilkan layanan administratif yang dibutuhkan warga. Prosesnya juga memiliki aktor, dokumen, keputusan verifikasi, dan output yang jelas.

---

## 3. Penyampaian Pengaduan Warga Terkait Masalah Publik Desa

### Definisi Singkat
Proses bisnis ini menggambarkan alur ketika warga menyampaikan keluhan atau pengaduan mengenai masalah publik di lingkungan desa, seperti fasilitas rusak, kebersihan, drainase, lampu, atau persoalan lingkungan sekitar.

### Tujuan Proses
Memberikan saluran bagi warga untuk melaporkan masalah publik agar pemerintah desa dapat mengetahui, mencatat, dan menindaklanjuti persoalan yang terjadi di lingkungan masyarakat.

### Aktor Utama
- Warga
- Petugas desa/admin pengelola pengaduan
- Unit atau petugas lapangan terkait
- Kepala desa/perangkat terkait jika diperlukan untuk keputusan lanjutan

### Input
- Laporan warga
- Deskripsi masalah
- Lokasi/alamat kejadian
- Bukti pendukung bila ada

### Output
- Pengaduan tercatat
- Pengaduan diverifikasi
- Pengaduan diteruskan/ditindaklanjuti
- Warga menerima informasi status penanganan

### Narasi Proses Bisnis Awal/Existing
Berdasarkan konteks pelayanan desa, diskusi tim, dan arah solusi GovConnect, proses awal yang paling masuk akal adalah:

1. Warga melihat atau mengalami masalah di lingkungan sekitar.
2. Warga menyampaikan laporan secara langsung ke kantor desa, melalui perangkat desa, atau secara informal kepada RT/RW.
3. Petugas menerima laporan dan mencatatnya secara manual, baik di buku, catatan pribadi, atau media komunikasi terpisah.
4. Jika informasi belum jelas, warga diminta menjelaskan ulang lokasi, jenis masalah, dan tingkat urgensinya.
5. Laporan diteruskan ke pihak yang dianggap relevan di lingkungan desa.
6. Tindak lanjut dilakukan sesuai kemampuan desa atau diteruskan lagi jika masalah berada di luar kewenangan langsung desa.
7. Warga menunggu kabar atau menanyakan kembali perkembangan penanganan.

### Ciri Permasalahan pada Proses Existing
- Pengaduan bisa tidak tercatat secara rapi.
- Laporan rawan tercecer karena menggunakan media komunikasi yang terpisah-pisah.
- Tidak semua warga tahu harus melapor ke siapa.
- Sulit memantau prioritas dan status penanganan.
- Ada kemungkinan tumpang tindih atau keterlambatan tindak lanjut.

### Referensi GovConnect / Arah As-Is–To-Be
GovConnect memperlihatkan adanya alur pengaduan warga yang lebih terstruktur: pengumpulan kategori, deskripsi, alamat, klarifikasi data, pencatatan laporan, dan pelacakan status. Ini menunjukkan bahwa pengaduan dapat ditata menjadi proses formal, bukan sekadar komunikasi informal.

Namun, untuk kepentingan akademik, proses ini sebaiknya tetap diposisikan sebagai **pengaduan masalah publik desa**, bukan sebagai proses lintas instansi seperti damkar, polisi, atau ambulans yang kepemilikannya berada di luar desa.

### Alasan Layak Dijadikan Objek BPMN
Proses ini penting karena mewakili fungsi responsif pemerintah desa terhadap masalah publik. Selain itu, prosesnya cukup kaya untuk dimodelkan: ada intake, verifikasi, klasifikasi, disposisi, dan umpan balik ke warga.

---

## 4. Pelacakan Status Permohonan atau Pengaduan oleh Warga

### Definisi Singkat
Proses bisnis ini menggambarkan bagaimana warga menanyakan perkembangan permohonan layanan atau pengaduan yang sebelumnya sudah diajukan.

### Tujuan Proses
Memberikan kepastian informasi kepada warga mengenai apakah permohonan/pengaduan sudah diterima, sedang diproses, selesai, atau masih membutuhkan tindak lanjut tambahan.

### Aktor Utama
- Warga
- Petugas pelayanan desa/admin
- Unit pengelola permohonan/pengaduan

### Input
- Nomor referensi, identitas warga, atau informasi pengajuan sebelumnya
- Pertanyaan warga mengenai perkembangan status

### Output
- Informasi status proses
- Penjelasan tindak lanjut yang diperlukan
- Kejelasan apakah proses selesai, masih berjalan, atau perlu pelengkapan tambahan

### Narasi Proses Bisnis Awal/Existing
Berdasarkan konteks pelayanan desa, diskusi tim, dan arah solusi GovConnect, proses awal yang paling masuk akal adalah:

1. Setelah mengajukan layanan atau pengaduan, warga menunggu proses berjalan.
2. Jika ingin mengetahui perkembangan, warga datang lagi ke kantor desa, menghubungi petugas, atau bertanya melalui RT/RW/perangkat terkait.
3. Petugas mencoba mencari informasi berdasarkan ingatan, catatan manual, atau komunikasi internal.
4. Jika data sulit ditemukan, warga mungkin diminta menunggu atau datang kembali.
5. Petugas menyampaikan apakah berkas/laporan masih diproses, sudah selesai, atau perlu tambahan dokumen/informasi.

### Ciri Permasalahan pada Proses Existing
- Transparansi status rendah.
- Warga harus aktif bertanya ulang.
- Informasi status bisa terlambat atau tidak konsisten.
- Waktu petugas habis untuk menjawab pertanyaan berulang.
- Tidak ada riwayat status yang terdokumentasi secara rapi.

### Referensi GovConnect / Arah As-Is–To-Be
GovConnect menunjukkan bahwa pelacakan status bisa menjadi proses tersendiri yang formal, baik untuk permohonan layanan maupun pengaduan. Arah digitalisasinya memperlihatkan bahwa setiap pengajuan dapat memiliki referensi tertentu dan statusnya dapat diperbarui secara lebih sistematis.

Dengan demikian, pelacakan status layak dipisahkan sebagai proses bisnis sendiri, bukan hanya dianggap bagian kecil dari pengajuan, karena dari sudut pandang warga proses ini punya kebutuhan informasi, interaksi, dan nilai layanan yang berbeda.

### Alasan Layak Dijadikan Objek BPMN
Proses ini sangat penting bagi kualitas pelayanan karena berkaitan langsung dengan transparansi, kepastian, dan kepuasan warga. Dari sisi pemodelan, proses ini juga cukup jelas dan dapat dianalisis sebagai proses tersendiri.

---

# Rekomendasi Pembagian ke 4 Anggota Tim
Agar pembagian kerja lebih seimbang, empat proses bisnis ini dapat dibagi sebagai berikut:

1. **Anggota 1**: Pencarian informasi layanan dan persyaratan administrasi
2. **Anggota 2**: Pengajuan layanan administrasi/surat oleh warga
3. **Anggota 3**: Penyampaian pengaduan warga terkait masalah publik desa
4. **Anggota 4**: Pelacakan status permohonan atau pengaduan oleh warga

Pembagian ini cukup aman karena masing-masing proses memiliki:
- tujuan yang berbeda,
- aktor yang bisa dibedakan,
- masalah existing yang berbeda,
- dan potensi redesign yang juga berbeda.

---

# Catatan untuk Bab 1–2
Dokumen ini aman dipakai sebagai **draft awal** untuk penyusunan Bab 1–2, terutama untuk:
- menjelaskan konteks pelayanan publik yang dipilih,
- menentukan objek proses bisnis,
- menyusun narasi proses bisnis eksisting,
- dan membagi topik BPMN per anggota.

Namun, untuk versi final yang lebih kuat secara akademik, isi dokumen ini tetap sebaiknya **divalidasi lewat wawancara** dengan pihak desa/kecamatan atau pihak yang benar-benar memahami alur pelayanan aktual di Sangreseng Ade.

Dengan kata lain, dokumen ini paling tepat dipakai sebagai:
- **working draft yang terarah**, bukan klaim final tanpa verifikasi lapangan.

---

# Rekomendasi Singkat Paling Aman
Kalau harus memilih 4 proses bisnis yang paling aman dan paling nyambung dengan GovConnect sekaligus tetap fokus ke Desa Sangreseng Ade, maka pilihan terbaik adalah:

1. **Informasi layanan dan persyaratan**
2. **Pengajuan layanan administrasi desa**
3. **Pengaduan warga terkait masalah publik desa**
4. **Pelacakan status permohonan/pengaduan**

Empat proses ini paling kuat karena masih berada dalam ruang pelayanan publik desa, tidak terlalu bergantung pada instansi lain sebagai pemilik utama proses, dan mudah dijelaskan baik dalam bentuk **proses existing** maupun **arah redesign/digitalisasi**.
