// Corrective: TokenRouter's deepseek-v4-flash rejects tool_choice in thinking mode (400),
// which breaks all agent tool-calling (RAG/report/cancel/service) on fallover.
// xiaomi/mimo-v2.5 supports tool_choice required+auto AND json_object mode, so it works
// for both micro-NLU and the agent. Repoint the existing TokenRouter llm-lane model to it.
const fs = require('fs');
const admin = require('./dist/services/ai-admin-config.service.js');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PROVIDER_SLUG = 'tokenrouter-openai-compatible';
const NEW_UPSTREAM = 'xiaomi/mimo-v2.5-pro';
const NEW_DISPLAY = 'TokenRouter MiMo v2.5 Pro';
const LANE = 'llm';

async function main() {
  const result = { steps: [] };
  const provider = await prisma.ai_providers.findUnique({ where: { slug: PROVIDER_SLUG } });
  if (!provider) throw new Error('TokenRouter provider not found');
  result.provider_id = provider.id;

  const model = await prisma.ai_models.findFirst({
    where: { provider_id: provider.id, lane_type: LANE },
  });
  if (!model) throw new Error('TokenRouter llm-lane model not found');
  result.model_id = model.id;
  result.old_upstream = model.upstream_model_name;

  await admin.updateAIModel({
    id: model.id,
    upstream_model_name: NEW_UPSTREAM,
    display_name: NEW_DISPLAY,
    is_active: true,
    priority: 90,
  });
  result.new_upstream = NEW_UPSTREAM;
  result.steps.push('model_repointed_to_mimo');

  // Confirm lane still references this model as fallback.
  const assignment = await prisma.ai_lane_assignments.findFirst({
    where: { lane_type: LANE, village_id: null, is_global_default: true },
  });
  result.lane_fallback_model_id = assignment?.fallback_model_id;
  result.lane_ok = assignment?.fallback_model_id === model.id;

  fs.writeFileSync('/tmp/tr-fix-result.json', JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  fs.writeFileSync('/tmp/tr-fix-result.json', JSON.stringify({ error: e.message, stack: e.stack }, null, 2));
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
