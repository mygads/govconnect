import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { encryptSecret } from '../src/utils/crypto';

const prisma = new PrismaClient();

const NEW_API_KEY = process.env.OPENROUTER_API_KEY ?? '';
const OPENROUTER_PROVIDER_ID = 'cmoeka7pf0000jtyse664oy8w';

const LLM_MODELS = [
  'openai/gpt-oss-120b:free',
  'openrouter/owl-alpha',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'poolside/laguna-m.1:free',
  'z-ai/glm-4.5-air:free',
  'minimax/minimax-m2.5:free',
];

const EMBED_MODEL = 'nvidia/llama-nemotron-embed-vl-1b-v2:free';

async function main() {
  console.log('[1/4] Updating OpenRouter provider API key...');
  const encrypted = encryptSecret(NEW_API_KEY);
  await prisma.ai_providers.update({
    where: { id: OPENROUTER_PROVIDER_ID },
    data: { api_key_encrypted: encrypted, is_active: true, updated_at: new Date() },
  });
  console.log('  ✓ API key updated');

  console.log('[2/4] Deactivating old failing models...');
  await prisma.ai_models.updateMany({
    where: {
      provider_id: OPENROUTER_PROVIDER_ID,
      upstream_model_name: { in: ['inclusionai/ling-2.6-1t:free', 'tencent/hy3-preview:free'] },
    },
    data: { is_active: false, updated_at: new Date() },
  });
  console.log('  ✓ Deactivated ling-2.6-1t and hy3-preview');

  console.log('[3/4] Upserting test models for LLM, rewrite, rerank lanes...');
  for (const lane of ['llm', 'rewrite', 'rerank'] as const) {
    for (const upstream of LLM_MODELS) {
      const id = `test-${lane}-${upstream.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`.slice(0, 60);
      await prisma.ai_models.upsert({
        where: {
          provider_id_lane_type_upstream_model_name: {
            provider_id: OPENROUTER_PROVIDER_ID,
            lane_type: lane,
            upstream_model_name: upstream,
          },
        },
        update: { is_active: true, display_name: `${upstream} (${lane})`, endpoint_path: '/chat/completions', updated_at: new Date() },
        create: {
          id,
          provider_id: OPENROUTER_PROVIDER_ID,
          lane_type: lane,
          display_name: `${upstream} (${lane})`,
          upstream_model_name: upstream,
          endpoint_path: '/chat/completions',
          is_active: true,
          updated_at: new Date(),
        },
      });
    }
  }
  console.log(`  ✓ Upserted ${LLM_MODELS.length * 3} models`);

  console.log('[4/4] Ensuring embed model is active...');
  await prisma.ai_models.updateMany({
    where: { provider_id: OPENROUTER_PROVIDER_ID, lane_type: 'embed', upstream_model_name: EMBED_MODEL },
    data: { is_active: true, updated_at: new Date() },
  });
  console.log('  ✓ Embed model active');

  const activeModels = await prisma.ai_models.findMany({
    where: { provider_id: OPENROUTER_PROVIDER_ID, is_active: true },
    select: { id: true, lane_type: true, upstream_model_name: true },
    orderBy: [{ lane_type: 'asc' }, { upstream_model_name: 'asc' }],
  });
  console.log('\nActive OpenRouter models:');
  for (const m of activeModels) {
    console.log(`  [${m.lane_type}] ${m.upstream_model_name} (id=${m.id})`);
  }
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
