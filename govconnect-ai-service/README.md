# GovConnect AI Service

AI Orchestrator stateless untuk GovConnect. Service ini menerima pesan warga, menjalankan NLU/RAG, berkoordinasi dengan service lain, lalu mengembalikan jawaban ke channel.

## Arsitektur AI Gateway

Semua traffic AI sekarang **wajib** lewat AI gateway OpenAI-compatible. Tidak ada lagi jalur provider langsung terpisah.

Lane yang tersedia:

1. `LLM` untuk chat completions utama.
2. `EMBED` untuk vector embeddings.
3. `RAG` untuk query rewrite sebelum retrieval.
4. `RERANK` untuk reranking hasil retrieval.

Setiap lane punya konfigurasi sendiri:

- `*_PROVIDER`
- `*_API_KEY`
- `*_BASE_URL`
- `*_MODEL`

Jika satu lane tidak lengkap, lane tersebut dianggap nonaktif.

Provider yang didukung adapter:

- `openrouter`
- `sumopod`
- `vercel`
- `cloudflare`
- `direct`

## Quick Start

```bash
pnpm install
cp .env.example .env
```

Isi minimal:

```env
LLM_PROVIDER=openrouter
LLM_API_KEY=your_openrouter_api_key_here
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=openai/gpt-4o-mini

EMBED_PROVIDER=openrouter
EMBED_API_KEY=your_openrouter_api_key_here
EMBED_BASE_URL=https://openrouter.ai/api/v1
EMBED_MODEL=openai/text-embedding-3-small

RAG_PROVIDER=openrouter
RAG_API_KEY=your_openrouter_api_key_here
RAG_BASE_URL=https://openrouter.ai/api/v1
RAG_REWRITE_MODEL=openai/gpt-4o-mini

RERANK_PROVIDER=openrouter
RERANK_API_KEY=your_openrouter_api_key_here
RERANK_BASE_URL=https://openrouter.ai/api/v1
RERANK_MODEL=cohere/rerank-v3.5
RERANK_ENABLED=true
```

Lalu jalankan sesuai workflow proyek.

## Document Storage

Knowledge document upload tidak lagi mengandalkan storage lokal sebagai sumber utama. File asli sekarang diunggah ke object storage S3-compatible yang dikonfigurasi lewat:

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_PATH_STYLE`
- `S3_PUBLIC_URL`
- `S3_MEDIA_DELIVERY=s3`

Untuk Cloudflare R2 via S3 API, gunakan `S3_REGION=auto`.

Catatan:

- AI service masih boleh memakai file temporer lokal saat parsing PDF/DOCX/PPT, tetapi file final yang direferensikan dashboard disimpan di object storage.
- Route `/uploads/documents/*` tetap dipertahankan untuk backward compatibility dokumen lama yang sudah terlanjur lokal.

## Variabel Penting

| Variable | Kegunaan |
|---|---|
| `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | Lane chat completions utama |
| `EMBED_PROVIDER` / `EMBED_API_KEY` / `EMBED_BASE_URL` / `EMBED_MODEL` | Lane embedding |
| `RAG_PROVIDER` / `RAG_API_KEY` / `RAG_BASE_URL` / `RAG_REWRITE_MODEL` | Lane rewrite query |
| `RERANK_PROVIDER` / `RERANK_API_KEY` / `RERANK_BASE_URL` / `RERANK_MODEL` / `RERANK_ENABLED` | Lane rerank |
| `OPENROUTER_SITE_URL` / `OPENROUTER_APP_NAME` | Header observability OpenRouter |
| `RAG_ENABLE_RETRIEVAL_CACHE` | Aktifkan cache retrieval RAG |
| `AI_MODEL_PRICING_OVERRIDES` | Override pricing model untuk cost tracking |

## Endpoint Operasional

- `GET /health`
  Menampilkan health service dan snapshot konfigurasi semua lane.
- `POST /api/testing/ping`
  Mengetes `llm`, `embed`, `rag`, dan `rerank` sekaligus.
- `GET /stats/models`
  Statistik model yang benar-benar dipakai.
- `GET /stats/embeddings`
  Statistik embedding dan vector DB.

Contoh payload health:

```json
{
  "status": "ok",
  "service": "ai-orchestrator",
  "gateways": {
    "llm": { "provider": "openrouter", "model": "openai/gpt-4o-mini" },
    "embed": { "provider": "openrouter", "model": "openai/text-embedding-3-small" },
    "rag": { "provider": "openrouter", "model": "openai/gpt-4o-mini" },
    "rerank": { "provider": "openrouter", "model": "cohere/rerank-v3.5" }
  }
}
```

## Catatan Implementasi

- `LLM`, `confirmation classifier`, `smart chunking`, `query expansion`, `embedding`, dan `rerank` memakai adapter gateway yang sama.
- RAG rewrite memakai lane `RAG`, bukan lane chat utama.
- Embedding metadata yang disimpan ke vector store mengikuti `EMBED_MODEL`.
- Dashboard superadmin sekarang menampilkan status per lane, bukan satu ping LLM tunggal.

## Monitoring yang Disarankan

- Pantau `GET /health` dan `POST /api/testing/ping`.
- Pantau `stats/models` dan `stats/token-usage/*`.
- Isi `AI_MODEL_PRICING_OVERRIDES` jika model provider tidak punya pricing bawaan di service.
- Gunakan `OPENROUTER_PROVIDER_ORDER`, `OPENROUTER_ALLOW_FALLBACKS`, dan `OPENROUTER_ZDR_ONLY` bila perlu mengontrol routing/retensi.
