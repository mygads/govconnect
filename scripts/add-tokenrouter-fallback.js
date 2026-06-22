// One-off ops script: add TokenRouter as a cross-vendor fallback for the llm lane.
// Run inside the govconnect-ai-service container. Writes result JSON to /tmp/tr-result.json.
// Idempotent: re-running reuses the existing provider/model by slug / (provider,lane,upstream).
const fs = require('fs');
const admin = require('./dist/services/ai-admin-config.service.js');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PROVIDER_SLUG = 'tokenrouter-openai-compatible';
const BASE_URL = 'https://api.tokenrouter.com/v1';
const API_KEY = process.env.TR_KEY;
const UPSTREAM_MODEL = 'deepseek/deepseek-v4-flash';
const LANE = 'llm';

async function main() {
  const result = { steps: [] };
  if (!API_KEY) throw new Error('TR_KEY env not set');

  // 1) Provider (reuse by slug if present)
  let provider = await prisma.ai_providers.findUnique({ where: { slug: PROVIDER_SLUG } });
  if (!provider) {
    provider = await admin.createAIProvider({
      name: 'TokenRouter',
      slug: PROVIDER_SLUG,
      provider_kind: 'openai_compatible',
      base_url: BASE_URL,
      api_key: API_KEY,
      is_active: true,
      priority: 100,
    });
    result.steps.push('provider_created');
  } else {
    // ensure key + base_url current, and active
    await admin.updateAIProvider({ id: provider.id, base_url: BASE_URL, api_key: API_KEY, is_active: true });
    result.steps.push('provider_updated');
  }
  result.provider_id = provider.id;

  // 2) Model in the llm lane (reuse by unique (provider, lane, upstream))
  let model = await prisma.ai_models.findFirst({
    where: { provider_id: provider.id, lane_type: LANE, upstream_model_name: UPSTREAM_MODEL },
  });
  if (!model) {
    model = await admin.createAIModel({
      provider_id: provider.id,
      lane_type: LANE,
      display_name: 'TokenRouter Deepseek v4 Flash',
      upstream_model_name: UPSTREAM_MODEL,
      is_active: true,
      is_publicly_selectable: false,
      priority: 90, // higher priority (lower number) than the databyte extras so it's the first cross-vendor fallback
    });
    result.steps.push('model_created');
  } else {
    await admin.updateAIModel({ id: model.id, is_active: true, priority: 90 });
    result.steps.push('model_updated');
  }
  result.model_id = model.id;

  // 3) Repoint the global llm lane fallback to this cross-vendor model
  const assignment = await prisma.ai_lane_assignments.findFirst({
    where: { lane_type: LANE, village_id: null, is_global_default: true },
  });
  if (!assignment) throw new Error('No global llm lane assignment found');
  result.previous_fallback_model_id = assignment.fallback_model_id;
  result.primary_model_id = assignment.primary_model_id;

  const updated = await admin.upsertAILaneAssignment({
    lane_type: LANE,
    primary_model_id: assignment.primary_model_id,
    fallback_model_id: model.id,
    is_active: true,
  });
  result.steps.push('lane_fallback_repointed');
  result.new_fallback_model_id = updated.fallback_model_id;

  fs.writeFileSync('/tmp/tr-result.json', JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  fs.writeFileSync('/tmp/tr-result.json', JSON.stringify({ error: e.message, stack: e.stack }, null, 2));
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
