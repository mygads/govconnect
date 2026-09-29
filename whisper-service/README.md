# whisper-service

Sidecar transkripsi voice note untuk GovConnect. Menerima audio (voice note
WhatsApp, OGG/Opus) dan mengembalikan teks — dipakai oleh
`govconnect-ai-service` (`src/pipeline/voice-pipeline.ts`).

Dijalankan sebagai **service terpisah** (bukan library di ai-service) karena:
runtime Python + bobot model ratusan MB–GB tidak pantas menggembungkan
deploy utama, dan kebutuhan CPU/RAM-nya berbeda.

## Kontrak API (dipakai ai-service — jangan diubah seenaknya)

- `POST /audio/transcriptions` — multipart `file` (wajib), `model` (opsional,
  diterima untuk kompatibilitas tapi server selalu pakai model yang di-load),
  `language` (opsional; jika ada dipakai sebagai hint, jika tidak ada server
  auto-detect). Response: `{"text": "..."}`.
- `GET /health` — `{"status":"ok","model":...,"device":...,"model_loaded":bool}`.
  Tidak me-load model; tetap 200 meski model belum di-load.

Validasi: file kosong → 400, ukuran > `WHISPER_MAX_AUDIO_MB` → 413,
content-type bukan audio → 400, engine gagal → 500.

Auth: jika `WHISPER_API_KEY` di-set (non-empty), semua endpoint kecuali
`/health` wajib header `Authorization: Bearer <key>`. Jika kosong → mode dev
lokal tanpa auth.

## Environment variables

| Var | Default | Keterangan |
|---|---|---|
| `WHISPER_MODEL` | `large-v3-turbo` | Model faster-whisper yang di-load |
| `WHISPER_DEVICE` | `auto` | `cpu` / `cuda` / `auto` (CUDA jika tersedia) |
| `WHISPER_COMPUTE_TYPE` | `int8` (CPU) / `float16` (CUDA) | Override tipe komputasi |
| `WHISPER_DOWNLOAD_ROOT` | HF cache default | Direktori cache/download model |
| `WHISPER_API_KEY` | (kosong) | Bearer token; kosong = tanpa auth |
| `WHISPER_MAX_AUDIO_MB` | `25` | Batas ukuran audio |
| `PORT` | `8000` | Port uvicorn (hanya docker CMD pakai 8000) |

Client ai-service (`voice-pipeline.ts`) memakai env: `WHISPER_ENABLED`,
`WHISPER_API_URL`, `WHISPER_API_KEY`, `WHISPER_MODEL`,
`WHISPER_LANGUAGE` (opsional — **jangan di-set** kecuali ada alasan kuat;
default auto-detect agar bahasa daerah tidak rusak).

## Menjalankan

### Docker (disarankan)

```bash
# Pre-download model saat build agar request pertama cepat
docker build -t whisper-service ./whisper-service
docker run -p 8000:8000 \
  -e WHISPER_API_KEY=rahasia \
  -v whisper-models:/models \
  whisper-service
```

### Via docker-compose (opsional, tidak ikut `up` default)

```bash
docker compose --profile stt up whisper-service -d
```

### Lokal (dev)

```bash
cd whisper-service
python -m venv .venv && .venv/bin/pip install -r requirements.txt
WHISPER_API_KEY=dev .venv/bin/uvicorn app:app --port 8000
```

### Koneksi dari ai-service

```env
WHISPER_ENABLED=true
WHISPER_API_URL=http://whisper-service:8000
WHISPER_API_KEY=rahasia          # sama dengan di service ini
WHISPER_MODEL=whisper-1          # hanya label kompatibilitas; model asli ikut server
# WHISPER_LANGUAGE dikosongkan -> auto-detect
```

## Kebutuhan resource (estimasi — ukur di hardware target)

- `large-v3-turbo` int8 (CPU): ±1.5–2 GB RAM untuk model + overhead proses.
  Rekomendasi kontainer: 4 GB RAM, 2+ vCPU.
- Voice note 1–2 menit tipikalnya selesai dalam belasan–puluhan detik di CPU
  4-core (bukan klaim benchmark — ukur sendiri).
- Butuh lebih enteng: pakai `WHISPER_MODEL=medium` atau `small`
  (±0.5–1 GB), atau GPU dengan `float16`.

## Bahasa daerah

Server **auto-detect** bahasa secara default (`language` tidak dikirim client
kecuali `WHISPER_LANGUAGE` di-set). Whisper dilatih terutama pada Bahasa
Indonesia; bahasa daerah (Jawa, Sunda, dll.) porsi datanya kecil sehingga
hasilnya bisa buruk. Mitigasi yang sudah ada di pipeline:

1. Jangan paksa `language=id` — merusak audio non-Indonesia.
2. `voice-pipeline.ts` melakukan cleanup mini-LLM lalu masuk pipeline teks
   biasa (klasifikasi intent tetap jalan di atas teks apa pun).
3. Jika confidence rendah / transkripsi gagal → balasan deterministik
   ("boleh diketik saja") atau handoff ke perangkat desa — tidak pernah diam.

**Belum terverifikasi**: akurasi untuk tiap bahasa daerah. Wajib uji lapangan
dengan voice note asli dari desa target sebelum mengklaim apa pun.

## Privasi

- Isi transkrip **tidak pernah** di-log; log hanya durasi, bahasa terdeteksi,
  dan panjang karakter.
- File audio hanya hidup di memori selama request; tidak disimpan ke disk.
- Untuk produksi: jalankan di jaringan internal (jangan expose publik),
  selalu set `WHISPER_API_KEY`.

## Test

```bash
.venv/bin/python -m pytest tests/ -v          # 17 unit test, tanpa download model
WHISPER_RUN_SLOW_TESTS=1 .venv/bin/python -m pytest tests/ -v -m slow  # opt-in, download model tiny
```
