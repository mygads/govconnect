# PRD — Hybrid OCR untuk Knowledge Base GovConnect

## 1. Ringkasan

GovConnect membutuhkan pipeline ingest dokumen knowledge base yang lebih akurat, hemat biaya, dan tahan terhadap dokumen campuran: PDF dengan text layer, halaman scan/gambar, tabel, slide, dan dokumen hasil fotokopi. Saat ini sistem sudah memiliki parsing native text, AI chunking, hybrid retrieval, dan embedding per desa. Namun, sistem belum memiliki OCR adaptif per halaman sehingga dokumen scan atau halaman tertentu yang gagal diekstrak berisiko tidak ikut ter-embed.

PRD ini mendefinisikan fitur **Hybrid OCR per halaman** untuk knowledge base. Sistem akan:

- mengekstrak native text terlebih dahulu,
- menilai kualitas hasil ekstraksi per halaman,
- menjalankan OCR hanya pada halaman yang memang membutuhkan,
- melakukan fallback bertingkat dari OCR lokal ke OCR vendor/LLM vision untuk halaman sulit,
- menggabungkan hasil final menjadi corpus yang siap di-chunk dan di-embed,
- membebankan biaya OCR dan embedding ke akun desa secara akurat.

Tujuan utamanya adalah meningkatkan recall retrieval tanpa membuat biaya ingest melonjak.

## 2. Latar Belakang

Saat ini alur ingest dokumen GovConnect secara umum adalah:

- upload dokumen dari dashboard,
- parse isi file,
- chunk dokumen,
- generate embedding,
- simpan ke vector DB.

Fondasi ini sudah baik, tetapi ada gap pada dokumen yang:

- hanya memiliki sebagian halaman yang dapat diekstrak native text,
- merupakan PDF scan tanpa text layer,
- memiliki tabel atau layout yang rusak saat parsing,
- memiliki halaman dengan teks terlalu sedikit atau karakter kacau,
- memiliki gambar penting berisi teks layanan atau prosedur.

Jika sistem hanya mengandalkan parsing native text, maka sebagian isi dokumen bisa hilang dari index. Jika semua halaman dipaksa OCR, biaya dan latensi menjadi terlalu tinggi. Karena itu dibutuhkan pendekatan hybrid per halaman.

## 3. Masalah Utama

### 3.1 Masalah pengguna/admin

Admin desa ingin saat upload dokumen knowledge base:

- semua isi penting ikut terbaca,
- dokumen yang sebagian scan tetap bisa dipakai,
- biaya pemrosesan tetap efisien,
- status proses jelas,
- hasil retrieval tidak miss informasi penting.

### 3.2 Masalah sistem

Sistem saat ini belum memiliki:

- routing OCR per halaman,
- penilaian kualitas ekstraksi per halaman,
- fallback OCR berlapis,
- pencatatan provenance chunk berdasarkan sumber teks,
- metering OCR detail per desa,
- evaluasi kualitas ingest terhadap dokumen campuran.

## 4. Goals

### 4.1 Product goals

- Meningkatkan kelengkapan teks hasil ingest dokumen knowledge base.
- Menurunkan risiko informasi penting tidak ter-embed.
- Menjaga biaya OCR dan embedding tetap efisien per desa.
- Memberikan status proses yang transparan ke admin dashboard.

### 4.2 Technical goals

- Menjalankan OCR hanya pada halaman yang dibutuhkan.
- Mendukung fallback otomatis: native text → OCR lokal → OCR vendor/LLM.
- Menyimpan metadata kualitas dan asal teks untuk setiap halaman/chunk.
- Mendukung retry, observability, dan cost attribution per desa.

## 5. Non-Goals

- Belum membangun Graph RAG.
- Belum mengekstrak struktur tabel sempurna untuk seluruh format dokumen.
- Belum melakukan reasoning multimodal end-to-end pada saat retrieval.
- Belum mendukung video/audio OCR/transcription sebagai bagian fitur ini.

## 6. User Stories

### 6.1 Admin desa

- Sebagai admin desa, saya ingin mengunggah PDF campuran agar semua halaman relevan masuk knowledge base, termasuk halaman scan.
- Sebagai admin desa, saya ingin melihat status dokumen diproses, OCR dilakukan atau tidak, dan jika gagal saya tahu alasannya.
- Sebagai admin desa, saya ingin biaya pemrosesan dibebankan akurat ke desa saya.

### 6.2 Sistem AI

- Sebagai sistem retrieval, saya ingin setiap chunk memiliki sumber yang jelas agar saya bisa memberi bobot berbeda pada teks native vs OCR rendah-confidence.
- Sebagai sistem billing, saya ingin setiap pemanggilan OCR dan embedding tercatat per desa dan per dokumen.

## 7. Solusi yang Diusulkan

### 7.1 Prinsip inti

Pipeline menggunakan pendekatan **page-level hybrid OCR**:

1. Sistem mengekstrak native text terlebih dahulu.
2. Sistem menghitung kualitas hasil ekstraksi per halaman.
3. Hanya halaman yang lemah/blank yang dikirim ke OCR lokal.
4. Jika hasil OCR lokal masih buruk, halaman itu saja di-escalate ke OCR vendor atau LLM vision.
5. Teks final seluruh halaman digabung, lalu di-chunk dan di-embed.

### 7.2 Mengapa ini dipilih

- lebih hemat dibanding OCR full document,
- lebih aman dibanding selalu memakai vendor pihak ketiga,
- lebih akurat dibanding native parsing saja,
- lebih fleksibel untuk dokumen heterogen yang umum di lingkungan pemerintahan.

## 8. Scope Fitur

### 8.1 In scope

- PDF, DOCX, DOC, PPT, PPTX, TXT, MD, CSV untuk knowledge base.
- OCR per halaman untuk PDF scan/gambar-based pages.
- OCR lokal sebagai default.
- Fallback OCR vendor atau LLM vision untuk halaman sulit.
- Status job ingest dan OCR.
- Metering biaya per desa.
- Metadata provenance per halaman/chunk.

### 8.2 Out of scope

- OCR realtime dalam request pengguna warga.
- Reindex seluruh histori lama secara otomatis di fase awal.
- Semantic understanding diagram/grafik non-text secara penuh.

## 9. Arsitektur Produk

### 9.1 Alur end-to-end

1. Admin upload dokumen di dashboard knowledge.
2. Dashboard menyimpan metadata dokumen dan mengirim file ke AI service.
3. AI ingest service membuat job dokumen.
4. Parser mengekstrak native text per halaman.
5. Page analyzer memberi skor kualitas per halaman.
6. Halaman dengan skor rendah masuk ke OCR lokal.
7. Halaman dengan confidence OCR lokal rendah masuk fallback OCR vendor/LLM.
8. Hasil semua halaman digabung menjadi canonical extracted text.
9. Dokumen di-chunk dengan metadata halaman dan provenance.
10. Embedding dibuat dan disimpan ke `document_vectors`.
11. Biaya OCR + embedding dicatat ke usage desa.
12. Dashboard menampilkan status final dan ringkasan hasil.

### 9.2 Komponen layanan

- `upload/ingest API`: menerima file dan membuat job.
- `document parser`: ekstraksi native text.
- `page quality analyzer`: penentu apakah halaman perlu OCR.
- `ocr-local worker`: OCR default internal.
- `ocr-fallback worker`: vendor OCR atau LLM vision.
- `chunk/embed worker`: chunking dan embedding final.
- `usage meter`: pencatatan biaya per desa.
- `dashboard status API`: menampilkan progres ke admin.

## 10. Detail Fungsional

### 10.1 Deteksi kebutuhan OCR per halaman

Sistem harus menilai tiap halaman menggunakan sinyal berikut:

- panjang teks hasil parser,
- jumlah kata valid,
- rasio karakter aneh atau noise,
- kepadatan teks per halaman,
- indikasi image-only page,
- hasil confidence OCR bila OCR sudah dijalankan,
- pola tabel rusak atau teks yang terfragmentasi berat.

### 10.2 Aturan routing default

#### Native text only

Halaman tidak perlu OCR jika:

- text length memadai,
- rasio karakter valid tinggi,
- tidak terindikasi image-only,
- parser menghasilkan isi yang cukup stabil.

#### OCR lokal

Halaman masuk OCR lokal jika:

- native text kosong,
- text terlalu pendek terhadap ukuran halaman,
- karakter hasil parse tampak rusak,
- halaman diduga scan atau gambar.

#### OCR fallback vendor/LLM

Halaman masuk fallback jika:

- OCR lokal confidence rendah,
- hasil OCR lokal masih terlalu pendek,
- terdapat tabel/layout kompleks penting,
- halaman prioritas tinggi tetapi hasil baca masih buruk.

### 10.3 Rekomendasi threshold awal

Threshold awal ini bersifat configurable:

- `native_min_chars_per_page`: 120
- `native_valid_char_ratio`: 0.70
- `ocr_local_min_confidence`: 0.82
- `ocr_escalate_min_chars`: 80
- `llm_rescue_enabled`: true untuk halaman prioritas atau low-confidence
- `max_llm_ocr_pages_per_document`: 3

Threshold harus bisa di-tuning tanpa deploy ulang melalui config.

### 10.4 Output yang harus disimpan per halaman

Setiap halaman harus memiliki metadata:

- `page_number`
- `native_text`
- `native_quality_score`
- `ocr_status`
- `ocr_engine_used`
- `ocr_confidence`
- `final_text`
- `final_source` (`native`, `ocr_local`, `ocr_vendor`, `ocr_llm`, `merged`)
- `page_hash`
- `processing_time_ms`
- `cost_amount`
- `cost_currency`

### 10.5 Output yang harus disimpan per chunk

Setiap chunk hasil final harus menyimpan:

- `document_id`
- `chunk_index`
- `page_start`
- `page_end`
- `section_title`
- `content`
- `provenance_summary`
- `source_confidence`
- `embedding_model`
- `embedding_version`

## 11. OCR Strategy

### 11.1 Strategi yang direkomendasikan

GovConnect menggunakan strategi 3 lapis:

1. **Native extraction first** untuk semua dokumen.
2. **Local OCR default** untuk halaman yang perlu OCR.
3. **Vendor OCR atau LLM vision rescue** hanya untuk halaman gagal/sulit.

### 11.2 OCR lokal

OCR lokal direkomendasikan sebagai default karena:

- biaya marginal jauh lebih rendah,
- data lebih aman karena tidak selalu keluar ke vendor,
- cocok untuk throughput kecil-menengah,
- dapat dijalankan async sebagai worker.

Pilihan engine:

- `Tesseract` untuk baseline murah dan sederhana.
- `PaddleOCR` untuk akurasi lebih baik pada scan campuran dan layout lebih kompleks.

Rekomendasi fase implementasi:

- Fase 1: Tesseract.
- Fase 2: evaluasi upgrade ke PaddleOCR jika kualitas belum cukup.

### 11.3 OCR vendor

Vendor OCR cocok untuk:

- scan berkualitas rendah,
- kebutuhan layout/table extraction lebih baik,
- dokumen penting yang gagal di OCR lokal.

Vendor harus dipakai selektif karena biaya per halaman akan dibebankan ke desa.

### 11.4 LLM vision OCR

LLM vision **bukan OCR utama**. Ia dipakai sebagai rescue layer untuk:

- halaman sulit,
- tabel penting,
- teks hasil OCR yang ambigu,
- halaman prioritas ketika confidence rendah tetapi informasi krusial.

LLM vision lebih mahal, sehingga pemakaiannya harus dibatasi dengan guardrail.

## 12. Billing dan Cost Attribution

### 12.1 Prinsip billing

Semua biaya ingest dibebankan ke desa pemilik dokumen.

Komponen biaya:

- OCR lokal internal cost estimate,
- OCR vendor actual cost,
- LLM OCR/vision cost,
- embedding cost,
- optional reprocessing cost.

### 12.2 Satuan pencatatan

Minimal catat:

- `village_id`
- `document_id`
- `page_number`
- `feature_type` (`ocr_local`, `ocr_vendor`, `ocr_llm`, `embedding`)
- `provider`
- `model`
- `unit_count` (`pages`, `tokens`, `chars`)
- `unit_cost`
- `total_cost`
- `created_at`

### 12.3 Aturan model utama dan fallback

Untuk embedding, sistem sebaiknya menggunakan **satu model embedding aktif per index version**. Jika admin mengganti model utama/fallback:

- fallback boleh dipakai untuk availability,
- tetapi hasil embedding beda model tidak boleh dicampur sembarang dalam satu index aktif,
- jika model embedding berubah, sistem harus membuat `embedding_version` baru dan mendukung re-embed bertahap.

## 13. Dashboard UX Requirements

Admin harus bisa melihat:

- status dokumen: `uploaded`, `parsing`, `ocr_processing`, `embedding`, `completed`, `failed`
- jumlah halaman total
- jumlah halaman native only
- jumlah halaman OCR lokal
- jumlah halaman OCR fallback
- total chunk tersimpan
- estimasi biaya pemrosesan
- error message bila gagal

Admin juga sebaiknya bisa melihat badge seperti:

- `Text extracted normally`
- `Partial OCR applied`
- `Full OCR applied`
- `LLM rescue used`

## 14. Data Model Requirements

### 14.1 Tabel utama yang dibutuhkan

#### `knowledge_documents`

Tambahan field yang disarankan:

- `processing_status`
- `ocr_strategy`
- `embedding_version`
- `file_hash`
- `total_pages`
- `native_pages_count`
- `ocr_pages_count`
- `ocr_fallback_pages_count`
- `processing_cost_total`

#### `document_ocr_pages`

Menyimpan hasil pemrosesan per halaman:

- `id`
- `document_id`
- `page_number`
- `page_hash`
- `native_text`
- `native_quality_score`
- `ocr_status`
- `ocr_engine_used`
- `ocr_confidence`
- `final_text`
- `final_source`
- `cost_total`
- `metadata_json`
- `created_at`
- `updated_at`

#### `document_processing_jobs`

- `id`
- `document_id`
- `job_type`
- `status`
- `attempt_count`
- `last_error`
- `payload_json`
- `started_at`
- `finished_at`

#### `ai_usage_events` atau setara

Tambahkan event detail untuk OCR dan embedding per desa.

## 15. Processing States

State minimal:

- `uploaded`
- `queued`
- `parsing`
- `page_analysis`
- `ocr_processing`
- `ocr_fallback_processing`
- `chunking`
- `embedding`
- `completed`
- `partial_completed`
- `failed`

`partial_completed` dipakai bila dokumen tetap dapat di-index walaupun sebagian halaman gagal rescue, asalkan coverage minimum terpenuhi.

## 16. Business Rules

- Jika semua halaman native text valid, OCR tidak dijalankan.
- Jika hanya sebagian halaman perlu OCR, hanya halaman itu yang diproses OCR.
- Jika satu halaman gagal OCR lokal, hanya halaman itu yang di-escalate.
- Jika seluruh halaman scan, sistem boleh menjalankan OCR untuk semua halaman.
- Jika halaman hasil OCR tetap buruk, chunk dari halaman itu diberi confidence rendah.
- Jika dokumen duplicate berdasarkan `file_hash` dan `village_id`, sistem sebaiknya mencegah proses ulang kecuali admin memaksa reprocess.

## 17. Retrieval Implications

Metadata sumber teks perlu dimanfaatkan saat retrieval/rerank:

- chunk `native` dapat diberi bobot normal,
- chunk `ocr_local` dengan confidence tinggi dapat diperlakukan setara atau sedikit di bawah native,
- chunk `ocr_vendor` dapat diberi bobot normal,
- chunk `ocr_llm` dapat diberi bobot normal tetapi harus ditandai provenance,
- chunk low-confidence dapat sedikit diturunkan dalam heuristic rerank.

Ini penting agar hasil OCR buruk tidak mendominasi hasil search.

## 18. Success Metrics

### 18.1 Product metrics

- Penurunan jumlah dokumen gagal ingest karena text extraction kosong.
- Peningkatan tingkat keberhasilan jawaban berbasis knowledge doc.
- Penurunan komplain admin terkait dokumen “sudah upload tapi tidak kebaca”.

### 18.2 Quality metrics

- `document_text_coverage_rate`
- `page_ocr_trigger_rate`
- `ocr_local_success_rate`
- `ocr_fallback_rate`
- `retrieval_recall_at_k` untuk dataset evaluasi
- `answer_grounding_rate`

### 18.3 Cost metrics

- biaya rata-rata pemrosesan per dokumen
- biaya OCR fallback per desa
- persentase halaman yang butuh LLM rescue

## 19. Evaluasi dan QA

Harus ada dataset evaluasi dokumen campuran yang mencakup:

- PDF dengan full text layer,
- PDF scan penuh,
- PDF campuran sebagian scan,
- dokumen dengan tabel,
- slide PPT/PPTX,
- dokumen noisy hasil foto/scan rendah.

Metode evaluasi:

- cek coverage teks per halaman,
- cek quality score dan routing OCR,
- cek hasil chunking,
- cek retrieval recall untuk query yang jawabannya ada di halaman native dan OCR,
- cek biaya per dokumen.

## 20. Risiko dan Mitigasi

### Risiko 1: OCR lokal lambat

Mitigasi:

- jalankan async worker,
- batasi concurrency,
- gunakan queue,
- hanya OCR halaman yang perlu.

### Risiko 2: Biaya fallback vendor/LLM membengkak

Mitigasi:

- batasi jumlah halaman fallback per dokumen,
- aktifkan threshold confidence,
- gunakan quota per desa,
- tampilkan estimasi biaya.

### Risiko 3: Hasil OCR noisy masuk index

Mitigasi:

- simpan confidence per halaman/chunk,
- turunkan bobot retrieval untuk low-confidence,
- lakukan rescue hanya untuk halaman prioritas.

### Risiko 4: Pergantian model embedding membuat index campur

Mitigasi:

- pakai `embedding_version`,
- lakukan reindex bertahap,
- jangan campur hasil model embedding berbeda dalam index aktif yang sama.

## 21. Rekomendasi Implementasi Bertahap

### Fase 1 — Foundation

- Tambah state processing dokumen.
- Tambah page analysis per halaman.
- Tambah OCR lokal async worker.
- Simpan hasil per halaman.
- Metering biaya dasar per desa.

### Fase 2 — Smart Fallback

- Tambah fallback vendor OCR.
- Tambah LLM rescue untuk halaman terbatas.
- Tambah confidence-aware rerank weight.
- Tambah cache `page_hash`.

### Fase 3 — Optimization

- Tambah evaluasi offline retrieval benchmark.
- Tambah auto-tuning threshold.
- Tambah observability dan dashboard analytics ingest.

## 22. Open Questions

- Apakah OCR vendor akan dipilih satu provider atau multi-provider?
- Apakah LLM rescue memakai model vision yang sama dengan gateway utama atau lane khusus?
- Apakah dokumen lama akan di-reprocess bertahap?
- Apakah tabel perlu diekstrak sebagai markdown/table JSON di fase awal atau nanti?

## 23. Keputusan yang Direkomendasikan

Keputusan final yang direkomendasikan untuk GovConnect:

- gunakan **hybrid OCR per halaman**,
- gunakan **native extraction first**,
- gunakan **local OCR sebagai default**,
- gunakan **vendor OCR atau LLM vision sebagai fallback selektif**,
- jalankan seluruh proses secara **async job-based**,
- simpan **provenance, confidence, dan biaya per halaman**,
- gunakan **satu embedding model aktif per embedding version**,
- tambahkan **evaluasi retrieval offline** sebelum rollout penuh.

Dengan pendekatan ini, GovConnect mendapat trade-off terbaik antara akurasi, biaya, performa, dan kontrol operasional untuk knowledge base multi-desa.
