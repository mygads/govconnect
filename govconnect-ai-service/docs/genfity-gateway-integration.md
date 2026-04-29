# genfity-ai-gateway Integration

govconnect is a **customer** of `genfity-ai-gateway` (same level as OpenRouter, Sumopod, etc.).
Integration uses the OpenAI-compatible HTTP contract that the gateway exposes.

## Architectural boundary

- **genfity-ai-gateway** owns: provider management, key issuance, rate-limiting, billing/wallet
  for the gateway itself, all upstream provider plumbing.
- **govconnect-ai-service** owns: village-level wallet (`ai_village_wallets`), routing across
  multiple providers (govconnect-side), prompt construction, conversation state.

govconnect treats `genfity-ai-gateway` as one row in `ai_providers`. There may be multiple
gateway providers configured concurrently for failover.

## HTTP contract

Base URL example: `https://gateway.genfity.com/v1`

Authentication: `Authorization: Bearer <issued-key>` — keys issued by genfity admin and
inserted by govconnect super admin into `ai_providers.api_key_encrypted`.

Endpoints used (OpenAI-compatible):

| Lane    | Method | Path                                |
|---------|--------|-------------------------------------|
| llm     | POST   | `/v1/chat/completions`              |
| rag     | POST   | `/v1/chat/completions`              |
| embed   | POST   | `/v1/embeddings`                    |
| rerank  | POST   | `/v1/rerank`                        |

The path can be overridden per model via `ai_models.endpoint_path`.

## Super-admin setup

1. **Insert provider** (UI or SQL):
   ```sql
   -- via API: POST /admin/ai-providers
   {
     "name": "Genfity Gateway",
     "slug": "genfity-gateway-prod",
     "provider_kind": "genfity-gateway",
     "base_url": "https://gateway.genfity.com/v1",
     "api_key": "<your-issued-key>",
     "is_active": true
   }
   ```
   API key is encrypted at-rest (AES-256-GCM) before being persisted.

2. **Add models**:
   ```sql
   -- via API: POST /admin/ai-models
   {
     "provider_id": "<provider-id>",
     "lane_type": "llm",
     "display_name": "Genfity Llama-4-405B",
     "upstream_model_name": "meta/llama-4-405b-instruct",
     "endpoint_path": "/chat/completions"
   }
   ```

3. **Assign to lane**:
   ```sql
   -- via API: POST /admin/ai-lane-assignments
   {
     "lane_type": "llm",
     "primary_model_id": "<genfity-model-id>",
     "fallback_model_id": "<openrouter-model-id>",
     "is_global_default": true
   }
   ```

## Rerank path note

Genfity gateway exposes rerank at `/v1/rerank`. The default `RERANK_PATH` env var is `/rerank`
(legacy default). When using genfity-gateway as a rerank provider, set
`ai_models.endpoint_path = '/rerank'` (since base URL already contains `/v1`) **or**
`/v1/rerank` if base URL omits `/v1`.

## Smart routing interaction

Each call respects the smart-routing algorithm documented in `smart-routing.md`. If genfity
gateway returns repeated failures, it's demoted for 1 hour and traffic flows to the
fallback provider seamlessly.
