# AI Gateway Best Practices for GovConnect

Dokumen ini menjadi baseline operasional untuk GovConnect setelah arsitektur AI dipindahkan penuh ke **AI gateway OpenAI-compatible**.

## Arsitektur Final

Semua workload AI dipisah menjadi 4 lane:

1. `LLM`
   Untuk chat completions utama, full NLU, micro NLU, confirmation classifier, smart chunking, dan ping chat.
2. `EMBED`
   Untuk vector embeddings pada knowledge base dan dokumen.
3. `RAG`
   Untuk query rewrite sebelum retrieval.
4. `RERANK`
   Untuk reranking hasil retrieval.

Setiap lane punya:

- `PROVIDER`
- `API_KEY`
- `BASE_URL`
- `MODEL`

Jika satu lane tidak lengkap, lane itu dianggap nonaktif. Tidak ada inheritance tersembunyi antar-lane.

## Prinsip Desain

1. Semua call site bisnis harus vendor-agnostic.
   Flow complaint, layanan, knowledge, dan admin processing tidak boleh tahu provider aktifnya apa.

2. Provider switching hanya lewat ENV.
   Pindah dari OpenRouter ke SumoPod, Vercel, atau Cloudflare harus cukup dengan mengganti variabel lane.

3. Gunakan lane sesuai tanggung jawabnya.
   `LLM_MODEL` menjadi model tunggal untuk semua chat completion internal di lane `LLM`, sedangkan rewrite retrieval tetap memakai `RAG_REWRITE_MODEL`.

4. Health harus transparan.
   Jika lane gagal, kegagalan harus terlihat di:
   - `GET /health`
   - `POST /api/testing/ping`
   - dashboard superadmin

5. Tidak ada fallback diam-diam ke provider langsung di luar gateway.
   Kalau gateway lane gagal, itu dianggap incident konfigurasi atau provider, bukan alasan untuk kembali ke path lama.

## ENV Baseline

Contoh baseline yang direkomendasikan:

```env
# Lane 1: LLM
LLM_PROVIDER=openrouter
LLM_API_KEY=your_openrouter_api_key_here
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=openai/gpt-4o-mini
LLM_TIMEOUT_MS=30000

# Lane 2: Embed
EMBED_PROVIDER=openrouter
EMBED_API_KEY=your_openrouter_api_key_here
EMBED_BASE_URL=https://openrouter.ai/api/v1
EMBED_MODEL=openai/text-embedding-3-small
EMBED_DIMENSIONS=768
EMBED_TIMEOUT_MS=30000

# Lane 3: RAG
RAG_PROVIDER=openrouter
RAG_API_KEY=your_openrouter_api_key_here
RAG_BASE_URL=https://openrouter.ai/api/v1
RAG_REWRITE_MODEL=openai/gpt-4o-mini
RAG_QUERY_REWRITE_TIMEOUT_MS=10000

# Lane 4: Rerank
RERANK_PROVIDER=openrouter
RERANK_API_KEY=your_openrouter_api_key_here
RERANK_BASE_URL=https://openrouter.ai/api/v1
RERANK_MODEL=cohere/rerank-v3.5
RERANK_ENABLED=true
RERANK_TIMEOUT_MS=30000
RERANK_TOP_N=5

RAG_LLM_RERANK_MAX_CANDIDATES=12
RAG_ENABLE_RETRIEVAL_CACHE=true
RAG_RETRIEVAL_CACHE_TTL_SECONDS=300
```

Contoh saat ingin fokus SumoPod untuk LLM tapi lane lain tetap OpenRouter:

```env
LLM_PROVIDER=sumopod
LLM_API_KEY=...
LLM_BASE_URL=https://ai.sumopod.com
LLM_MODEL=google/gemini-2.5-flash-lite

EMBED_PROVIDER=openrouter
EMBED_API_KEY=your_openrouter_api_key_here
EMBED_BASE_URL=https://openrouter.ai/api/v1
EMBED_MODEL=openai/text-embedding-3-small
```

## Strategi Per Lane

### 1. LLM Lane

Gunakan untuk:

- `LLM_MODEL`
- classifier JSON
- main citizen reply
- smart chunking
- anti-hallucination retry

Praktik:

- Set `temperature` rendah untuk classifier.
- Pilih `LLM_MODEL` yang cukup murah untuk traffic default karena classifier dan jawaban utama sama-sama lewat lane ini.
- Jika perlu fallback model, lakukan dengan mengganti ENV lane, bukan menyimpan daftar model tersembunyi di service.
- Jangan gunakan model reasoning mahal untuk semua micro call.

### 2. Embed Lane

Gunakan untuk:

- indexing knowledge
- indexing chunk dokumen
- query embedding untuk search

Praktik:

- Pastikan `EMBED_DIMENSIONS` cocok dengan schema pgvector. Saat ini baseline GovConnect adalah `768`.
- Cache embedding query agar pertanyaan yang sama tidak selalu menembak provider.
- Metadata vector store harus menyimpan `EMBED_MODEL` aktual agar audit model tidak rancu.

### 3. RAG Lane

Gunakan untuk:

- rewrite pertanyaan warga menjadi query retrieval yang lebih jelas

Praktik:

- Model rewrite cukup kecil dan cepat.
- Timeout harus ketat, karena ini pre-retrieval step.
- Gunakan cache hasil rewrite untuk query berulang.

### 4. RERANK Lane

Gunakan untuk:

- scoring ulang kandidat retrieval
- menaikkan precision jawaban knowledge-heavy

Praktik:

- Batasi jumlah kandidat dengan `RAG_LLM_RERANK_MAX_CANDIDATES`.
- Aktifkan hanya bila memang membantu precision.
- Untuk dokumen kecil atau query trivial, rerank bisa dimatikan demi latency.

## Monitoring yang Wajib

### Health dan Ping

Pantau:

- `GET /health`
- `POST /api/testing/ping`

Target:

- semua lane punya status yang jelas
- provider dan model terbaca
- durasi per lane tercatat

### Token Usage

Minimal log berikut per call:

- `model`
- `layer_type`
- `call_type`
- `duration_ms`
- `success`
- `key_source`
- `key_id`
- `key_tier`

Gunakan dashboard AI usage untuk memisahkan:

- `micro_nlu`
- `full_nlu`
- `embedding`
- `rag_expand`
- `rag_rerank`

### Cost Tracking

Jika model provider tidak ada pricing bawaan di service, isi:

```env
AI_MODEL_PRICING_OVERRIDES={
  "openai/gpt-4o-mini":{"input":0.15,"output":0.60},
  "cohere/rerank-v3.5":{"input":0,"output":0}
}
```

Tanpa override, cost akan default ke `0` untuk model yang tidak dikenal.

## Cache Strategy

### Cache yang Sangat Direkomendasikan

1. Query rewrite cache
   Untuk query RAG yang sering berulang.

2. Query embedding cache
   Untuk menghemat biaya dan latency retrieval.

3. Retrieval result cache
   Aktifkan dengan:
   - `RAG_ENABLE_RETRIEVAL_CACHE=true`
   - `RAG_RETRIEVAL_CACHE_TTL_SECONDS=300`

4. FAQ response cache
   Aman untuk pertanyaan stabil dengan context tenant yang sama.

### Cache yang Perlu Dihindari

- Cache mentah untuk hasil tool calling yang sensitif.
- Cache jawaban citizen-facing jika knowledge snapshot sering berubah tapi invalidation belum ada.
- Cache global lintas tenant untuk data yang seharusnya scoped per desa.

## Parameter Profiles

### Micro NLU

- `temperature`: `0` sampai `0.2`
- `max_tokens`: kecil
- tujuan: deterministik, murah, cepat

Contoh use case:

- intent classify
- confirmation classify
- contact matching
- subtype detection

### Full NLU

- `temperature`: `0.2` sampai `0.4`
- `max_tokens`: sedang sampai besar
- tujuan: kualitas jawaban dan reasoning

Contoh use case:

- jawaban warga
- knowledge synthesis
- retry anti-hallucination

### Embedding

- gunakan dimensi yang konsisten
- aktifkan cache query
- jangan sering ganti model tanpa re-embedding plan

### RAG Rewrite

- timeout pendek
- output plain text, bukan JSON
- fokus pada istilah retrieval, bukan jawaban lengkap

### Rerank

- batasi dokumen masuk
- gunakan `top_n` seperlunya
- monitor tradeoff precision vs latency

## Structured Output / JSON Mode

JSON mode wajib untuk flow yang masuk ke business logic langsung:

- main intent classification
- confirmation classifier
- service slug matcher
- complaint type matcher
- chunk metadata extraction
- subtype classification

Praktik:

1. Tetap minta schema eksplisit di prompt.
2. Gunakan `response_format: { "type": "json_object" }` saat provider mendukung.
3. Siapkan fallback retry tanpa `response_format` untuk model/provider yang menolak JSON mode.
4. Validasi hasil dengan parser aplikasi sebelum dipakai.

JSON mode tidak wajib untuk:

- query rewrite
- ping test
- summary ringan

## Tool Calling / Function Calling

GovConnect belum harus memakainya di semua flow, tapi fondasinya layak disiapkan untuk lane `LLM`.

Use case yang cocok:

- lookup kontak penting terstruktur
- lookup service catalog
- cek status layanan/pengaduan
- retrieval helper yang dipisah dari prompt utama

Best practice:

1. Tool hanya untuk aksi deterministik.
2. Buat allowlist tool per flow.
3. Mulai dari read-only tool dulu.
4. Log nama tool, hash argumen, latency, dan hasil ringkas.
5. Jangan log payload sensitif mentah.

## OpenRouter-Specific Features

Kalau lane memakai OpenRouter, manfaatkan:

- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`
- `OPENROUTER_PROVIDER_ORDER`
- `OPENROUTER_ALLOW_FALLBACKS`
- `OPENROUTER_REQUIRE_PARAMETERS`
- `OPENROUTER_ZDR_ONLY`

Gunakan `OPENROUTER_PROVIDER_ORDER` saat Anda sudah tahu target upstream cost/latency.

Gunakan `OPENROUTER_ZDR_ONLY` jika ada kebutuhan retensi data lebih ketat.

## Security

1. Pisahkan API key per environment.
2. Jangan pakai key production untuk local development.
3. Redact data sensitif di log:
   - NIK
   - nomor HP
   - alamat detail
   - lampiran sensitif
4. Jangan simpan prompt mentah sensitif ke log production.
5. Jika satu provider dipakai oleh banyak lane, tetap audit per-lane source dan model.

## Rollout Checklist

Sebelum enable di production:

1. isi semua lane ENV yang dibutuhkan
2. cek `GET /health`
3. cek `POST /api/testing/ping`
4. tes chat warga
5. tes complaint flow
6. tes service request flow
7. tes indexing knowledge
8. tes upload dokumen dan smart chunking
9. tes retrieval + rerank
10. pantau stats model dan token usage

## Checklist Operasional Harian

- `LLM_PROVIDER`, `EMBED_PROVIDER`, `RAG_PROVIDER`, `RERANK_PROVIDER` sesuai target
- base URL lane benar
- key lane aktif
- model lane valid
- `LLM_MODEL` sesuai target latency/cost default
- `RERANK_ENABLED` sesuai target latency
- `RAG_ENABLE_RETRIEVAL_CACHE` aktif bila ingin hemat latency/cost
- dashboard superadmin menunjukkan lane status yang benar
- log provider/model membuktikan semua traffic benar-benar lewat gateway
