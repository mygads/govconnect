# ADR-20260130-full-llm-routing-golden-set

Status: Accepted

## Konteks
AI Orchestrator membutuhkan akurasi lebih tinggi dan konsistensi jawaban. Jalur deterministik (fast intent/template/cache) dapat mempercepat respons, namun menurunkan fleksibilitas konteks dan membuat percakapan terasa kurang “pintar”. Selain itu diperlukan pengukuran kualitas jawaban yang konsisten untuk super admin.

## Keputusan
1. Mengaktifkan routing penuh ke arsitektur LLM 2-layer untuk semua channel (WhatsApp dan Webchat).
2. Menonaktifkan jalur fast intent/template/cache pada AI optimizer agar semua pertanyaan diproses LLM.
3. Menambahkan evaluasi “golden set” dan metrik akurasi yang dapat diakses super admin melalui dashboard.
4. Menambahkan fallback otomatis saat LLM gagal total agar pengguna tetap mendapatkan respons.

## Konsekuensi
- Akurasi dan konsistensi jawaban meningkat, tetapi biaya token dan latensi bertambah.
- Diperlukan monitoring performa dan token usage.
- Evaluasi golden set menjadi acuan kualitas berkala tanpa menyimpan data ke DB AI (tetap stateless).
