# Cache Invalidation Webhook

Endpoint yang harus dipanggil **Dashboard** setiap kali admin mengubah data
yang bisa di-cache oleh AI service. Tanpa dipanggil, response cache dapat
menyajikan nilai lama sampai TTL habis (30 menit sampai 24 jam).

## Endpoint

```
POST /admin/cache/invalidate-village
Host: <ai-service-host>
Authorization: internal auth (x-internal-api-key header)
Content-Type: application/json
```

## Request body

```json
{
  "villageId": "village_abc123",          // required
  "intents": ["CONTACT_DIRECTORY"],       // optional — narrow invalidation
  "retrieval": true,                      // optional, default true
  "profile": true                         // optional, default true
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `villageId` | string | **required** | Village yang cache-nya harus di-flush |
| `intents` | string[] | all | Kalau disediakan, hanya entry yang cocok dengan salah satu intent ini yang dihapus. Value yang valid: `KNOWLEDGE_QUERY`, `SERVICE_INFO`, `VILLAGE_PROFILE`, `EMERGENCY_CONTACTS`, `CONTACT_DIRECTORY`, `GREETING` |
| `retrieval` | boolean | `true` | Juga clear cache retrieval RAG (embedding + hasil query) |
| `profile` | boolean | `true` | Juga clear cache village profile (alamat, jam buka, maps) |

## Response

```json
{
  "status": "success",
  "villageId": "village_abc123",
  "responseRemoved": 12,
  "retrievalRemoved": 5,
  "profileCacheCleared": true,
  "timestamp": "2026-05-10T22:00:00.000Z"
}
```

## Kapan harus dipanggil Dashboard

| Admin action | Intents to invalidate |
|--------------|----------------------|
| Edit kontak penting (important_contacts) | `["CONTACT_DIRECTORY", "EMERGENCY_CONTACTS"]` |
| Edit profil desa (alamat, jam, maps) | `["VILLAGE_PROFILE"]` + `profile: true` |
| Tambah/edit/hapus layanan (services, requirements, biaya) | `["SERVICE_INFO"]` |
| Tambah/edit/hapus kategori pengaduan | semua (omit `intents`) |
| Tambah/edit knowledge base entry | `["KNOWLEDGE_QUERY"]` + `retrieval: true` |
| Upload dokumen baru | `retrieval: true` (intents boleh dikosongkan) |

Saat ragu, panggil tanpa `intents` — aman tapi lebih agresif.

## Rate limiting

Tidak ada rate limit. Panggilan aman untuk dipicu per-edit; tidak ada side
effect selain membersihkan memory cache.

## Example (curl)

```bash
curl -X POST https://ai-service.example/admin/cache/invalidate-village \
  -H "x-internal-api-key: $INTERNAL_API_KEY" \
  -H "content-type: application/json" \
  -d '{"villageId":"village_abc123","intents":["CONTACT_DIRECTORY"]}'
```

## Testing

Setelah edit data di dashboard, dashboard bisa menambahkan integration
test yang:
1. Memanggil webhook
2. Memanggil AI endpoint testing (`POST /api/testing/ask`) dengan query
   yang sebelumnya di-cache
3. Memverifikasi response terbaru sudah mencerminkan data baru

## Fallback

Kalau webhook gagal dipanggil (network, timeout), tidak ada data yang
rusak. Cache akan expire sesuai TTL aslinya (maksimum 24 jam untuk
greeting, 1 jam untuk knowledge). Tetap recommend retry dengan backoff.
