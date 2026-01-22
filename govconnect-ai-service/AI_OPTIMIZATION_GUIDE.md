# AI Service Optimization Guide

## Overview

Dokumen ini menjelaskan optimasi yang telah diimplementasikan untuk meningkatkan performa dan mengurangi cost AI Service GovConnect.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AI SERVICE ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐    ┌─────────────────────────────────────────────┐    │
│  │   WhatsApp  │───▶│           UNIFIED MESSAGE PROCESSOR          │    │
│  └─────────────┘    │                                             │    │
│                     │  1. Spam Check                              │    │
│  ┌─────────────┐    │  2. Pending State Check                     │    │
│  │   Webchat   │───▶│  3. Fast Intent Classifier (NEW)            │    │
│  └─────────────┘    │  4. Response Cache Check (NEW)              │    │
│                     │  5. Entity Pre-extraction (NEW)             │    │
│                     │  6. Conversation FSM (NEW)                  │    │
│                     └─────────────────────────────────────────────┘    │
│                                        │                               │
│                     ┌──────────────────┴──────────────────┐            │
│                     │                                     │            │
│                     ▼                                     ▼            │
│          ┌─────────────────┐                   ┌─────────────────┐    │
│          │   FAST PATH     │                   │   LLM PATH      │    │
│          │  (Cache/Quick)  │                   │  (Full Process) │    │
│          │                 │                   │                 │    │
│          │  • Cache Hit    │                   │  • 2-Layer LLM  │    │
│          │  • Simple Intent│                   │  • RAG Context  │    │
│          │  • ~50ms        │                   │  • ~800ms       │    │
│          └─────────────────┘                   └─────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Optimizations Implemented

### 1. Fast Intent Classifier (`fast-intent-classifier.service.ts`)

**Tujuan:** Mengurangi latency dengan mengklasifikasi intent menggunakan pattern matching sebelum memanggil LLM.

**Cara Kerja:**
- Menggunakan regex patterns untuk mendeteksi intent yang jelas
- Jika confidence tinggi (>0.8), bisa skip LLM untuk beberapa intent
- Mengekstrak fields dasar (kategori complaint, service code, IDs)

**Intents yang Didukung:**
- `GREETING` - Sapaan (halo, hai, selamat pagi, dll)
- `CONFIRMATION` - Konfirmasi (ya, oke, lanjut, dll)
- `REJECTION` - Penolakan (tidak, batal, dll)
- `THANKS` - Terima kasih
- `CREATE_COMPLAINT` - Laporan masalah
- `CREATE_SERVICE_REQUEST` - Permohonan layanan
- `CHECK_STATUS` - Cek status dengan ID
- `CANCEL` - Pembatalan
- `HISTORY` - Riwayat
- `KNOWLEDGE_QUERY` - Pertanyaan informasi

**Penggunaan:**
```typescript
import { fastClassifyIntent } from './fast-intent-classifier.service';

const result = fastClassifyIntent("jam buka kantor kelurahan");
// result: { intent: 'KNOWLEDGE_QUERY', confidence: 0.85, skipLLM: false, ... }
```

### 2. Response Cache (`response-cache.service.ts`)

**Tujuan:** Mengurangi LLM calls untuk pertanyaan yang sering ditanyakan (FAQ).

**Cara Kerja:**
- Normalize query untuk matching yang lebih baik
- Cache response dengan TTL berbeda per intent type
- LRU eviction untuk memory management
- Pre-warm cache dengan common responses saat startup

**TTL Configuration:**
- Greeting: 24 jam
- Knowledge Query: 1 jam
- Default: 30 menit

**Cacheable Patterns:**
- Pertanyaan jam buka/tutup
- Pertanyaan lokasi/alamat
- Pertanyaan syarat/persyaratan
- Pertanyaan biaya
- Pertanyaan proses/prosedur

**Non-Cacheable:**
- Status check (user-specific)
- Data dengan NIK/phone
- History (user-specific)
- Complaint dengan lokasi spesifik

**Penggunaan:**
```typescript
import { getCachedResponse, setCachedResponse } from './response-cache.service';

// Check cache
const cached = getCachedResponse("jam buka kelurahan", "KNOWLEDGE_QUERY");
if (cached) {
  return cached.response;
}

// Store in cache
setCachedResponse(query, response, intent, guidanceText);
```

### 3. Entity Extractor (`entity-extractor.service.ts`)

**Tujuan:** Mengekstrak data terstruktur dari pesan user sebelum LLM processing.

**Entities yang Diekstrak:**
- `nik` - NIK 16 digit dengan validasi format
- `phone` - Nomor HP Indonesia (08xxx)
- `name` - Nama dari pola "nama saya X"
- `address` - Alamat dari berbagai pola
- `rtRw` - RT/RW
- `date` - Tanggal (besok, lusa, hari, tanggal Indonesia)
- `time` - Jam (jam 9 pagi, pukul 10, dll)
- `complaintId` - LAP-XXXXXXXX-XXX
- `requestNumber` - LAY-YYYYMMDD-XXX
- `email` - Email address

**Penggunaan:**
```typescript
import { extractAllEntities, mergeEntities } from './entity-extractor.service';

const result = extractAllEntities(message, conversationHistory);
// result.entities: { nik: '1234...', phone: '08123...', ... }

// Merge dengan LLM fields
const enhanced = mergeEntities(llmFields, result.entities);
```

### 4. AI Optimizer (`ai-optimizer.service.ts`)

**Tujuan:** Mengkoordinasikan semua optimasi dan menentukan fast path.

**Cara Kerja:**
1. Pre-process message dengan fast intent classifier
2. Check response cache
3. Extract entities
4. Determine if fast path available
5. Build fast path response atau continue ke LLM

**Penggunaan:**
```typescript
import { 
  preProcessMessage, 
  shouldUseFastPath, 
  buildFastPathResponse 
} from './ai-optimizer.service';

const optimization = preProcessMessage(message, userId, history);

if (shouldUseFastPath(optimization, hasPendingState)) {
  const fastResult = buildFastPathResponse(optimization, startTime);
  if (fastResult) return fastResult;
}

// Continue with LLM processing...
```

## Integration

Semua optimasi sudah terintegrasi ke `unified-message-processor.service.ts`:

```
┌─────────────────────────────────────────────────────────────┐
│                    MESSAGE RECEIVED                          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  1. Spam Check                                               │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Pending State Check                                      │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  3. AI Optimization (NEW)                                    │
│     • Fast Intent Classification                             │
│     • Response Cache Check                                   │
│     • Entity Pre-extraction                                  │
└─────────────────────────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
┌─────────────────────┐    ┌─────────────────────────────────┐
│  FAST PATH          │    │  FULL LLM PROCESSING            │
│  (Cache Hit or      │    │  • Typo Correction              │
│   Simple Intent)    │    │  • Language Detection           │
│                     │    │  • Sentiment Analysis           │
│  Return immediately │    │  • RAG Context                  │
└─────────────────────┘    │  • LLM Call                     │
                           │  • Intent Handling              │
                           │  • Response Validation          │
                           │  • Cache Response (NEW)         │
                           └─────────────────────────────────┘
```

## Monitoring

### Endpoint: `/stats/optimization`

```json
{
  "cache": {
    "totalHits": 150,
    "totalMisses": 50,
    "hitRate": 0.75,
    "hitRatePercent": "75.0%",
    "cacheSize": 45,
    "avgHitCount": 3.2
  },
  "topCachedQueries": [
    { "key": "jam buka kelurahan", "hitCount": 25, "intent": "KNOWLEDGE_QUERY" },
    { "key": "syarat buat skd", "hitCount": 18, "intent": "KNOWLEDGE_QUERY" }
  ]
}
```

## Expected Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Avg Response Time | ~2000ms | ~800ms | 60% faster |
| LLM Calls | 100% | ~70% | 30% reduction |
| Cost per 1000 msgs | $X | $0.7X | 30% savings |
| Cache Hit Rate | 0% | 30-50% | New metric |

## Configuration

Environment variables (optional):
```env
# Response cache
RESPONSE_CACHE_MAX_SIZE=500
RESPONSE_CACHE_DEFAULT_TTL=1800000  # 30 minutes

# Fast classifier
FAST_CLASSIFIER_ENABLED=true
```

## Files Created

1. `src/services/fast-intent-classifier.service.ts` - Fast intent classification
2. `src/services/response-cache.service.ts` - Response caching
3. `src/services/entity-extractor.service.ts` - Entity extraction
4. `src/services/ai-optimizer.service.ts` - Optimization coordinator
5. `src/services/conversation-fsm.service.ts` - Conversation state machine

## Files Modified

1. `src/services/unified-message-processor.service.ts` - Integration
2. `src/server.ts` - Optimizer initialization
3. `src/app.ts` - Monitoring endpoints

## Dashboard Integration

AI Analytics page di dashboard admin sudah diupdate untuk menampilkan:
- AI Optimization Performance (cache hit rate, savings)
- Top Cached Queries
- Conversation FSM Stats
- 2-Layer Architecture indicator

API Endpoints baru:
- `GET /api/statistics/ai-optimization` - Optimization stats dari AI Service

## Testing

Untuk test optimizations:

```bash
# Test fast intent classifier
curl -X POST http://localhost:3002/api/webchat \
  -H "Content-Type: application/json" \
  -d '{"session_id": "web_test", "message": "jam buka kantor"}'

# Check optimization stats
curl http://localhost:3002/stats/optimization
```

## Conversation FSM (Finite State Machine)

### States

| State | Description |
|-------|-------------|
| `IDLE` | Tidak ada percakapan aktif |
| `COLLECTING_COMPLAINT_DATA` | Mengumpulkan data laporan |
| `CONFIRMING_COMPLAINT` | Menunggu konfirmasi laporan |
| `COLLECTING_SERVICE_REQUEST_DATA` | Mengumpulkan data permohonan layanan |
| `CONFIRMING_SERVICE_REQUEST` | Menunggu konfirmasi permohonan layanan |
| `AWAITING_ADDRESS_DETAIL` | Menunggu detail alamat |
| `AWAITING_CONFIRMATION` | Menunggu konfirmasi umum |
| `CHECK_STATUS_FLOW` | Flow cek status |
| `CANCELLATION_FLOW` | Flow pembatalan |

### State Transitions

```
IDLE ──CREATE_COMPLAINT──▶ COLLECTING_COMPLAINT_DATA
                                    │
                          ┌─────────┴─────────┐
                          │                   │
                    ADDRESS_VAGUE      DATA_COMPLETE
                          │                   │
                          ▼                   ▼
              AWAITING_ADDRESS_DETAIL  CONFIRMING_COMPLAINT
                          │                   │
                    ┌─────┴─────┐       ┌─────┴─────┐
                    │           │       │           │
               CONFIRMED   ADDRESS   CONFIRMED  REJECTED
                    │      PROVIDED     │           │
                    ▼           │       ▼           ▼
                  IDLE          │     IDLE   COLLECTING...
                                │
                                ▼
                    COLLECTING_COMPLAINT_DATA
```

### Usage

```typescript
import { 
  getContext, 
  transition, 
  updateCollectedData,
  isDataComplete,
  getNextQuestion 
} from './conversation-fsm.service';

// Get or create context
const ctx = getContext(userId);

// Transition state
transition(userId, 'CREATE_COMPLAINT');

// Update collected data
updateCollectedData(userId, { kategori: 'jalan_rusak', alamat: 'Jl. Merdeka' });

// Check if data complete
if (isDataComplete(userId)) {
  transition(userId, 'DATA_COMPLETE');
}

// Get next question to ask
const question = getNextQuestion(userId);
```

## Future Improvements

1. **Redis-based Cache** - Untuk distributed caching dan state persistence
2. **ML-based Intent Classifier** - Lebih akurat dari regex
3. **A/B Testing** - Compare optimization strategies
4. **Predictive Caching** - Pre-cache responses berdasarkan patterns
