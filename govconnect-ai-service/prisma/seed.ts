import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

type LaneSeedConfig = {
  laneType: 'llm' | 'embed' | 'rewrite' | 'rerank';
  provider: string;
  apiKey: string;
  baseUrl: string;
  upstreamModel: string;
  fallbackModel?: string;
  endpointPath: string;
  pricingType: 'fixed_per_call' | 'per_million_tokens';
  fixedPriceUsd?: number;
  inputPricePerMillionUsd?: number;
  outputPricePerMillionUsd?: number;
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function laneDisplayName(laneType: LaneSeedConfig['laneType'], model: string): string {
  const prefix = {
    llm: 'LLM',
    embed: 'Embed',
    rewrite: 'Rewrite',
    rerank: 'Rerank',
  }[laneType];
  return `${prefix} ${model}`;
}

function parseLaneSeedConfigs(): LaneSeedConfig[] {
  const env = process.env;
  const configs: LaneSeedConfig[] = [];

  const maybePush = (config: LaneSeedConfig) => {
    if (config.provider && config.baseUrl && config.upstreamModel) {
      configs.push(config);
    }
  };

  maybePush({
    laneType: 'llm',
    provider: env.LLM_PROVIDER || '',
    apiKey: env.LLM_API_KEY || '',
    baseUrl: env.LLM_BASE_URL || '',
    upstreamModel: env.LLM_MODEL || '',
    fallbackModel: env.LLM_MODEL_FALLBACK || '',
    endpointPath: env.LLM_CHAT_COMPLETIONS_PATH || '/chat/completions',
    pricingType: 'per_million_tokens',
    inputPricePerMillionUsd: 0,
    outputPricePerMillionUsd: 0,
  });

  maybePush({
    laneType: 'embed',
    provider: env.EMBED_PROVIDER || '',
    apiKey: env.EMBED_API_KEY || '',
    baseUrl: env.EMBED_BASE_URL || '',
    upstreamModel: env.EMBED_MODEL || '',
    endpointPath: env.EMBED_EMBEDDINGS_PATH || '/embeddings',
    pricingType: 'per_million_tokens',
    inputPricePerMillionUsd: 0,
    outputPricePerMillionUsd: 0,
  });

  maybePush({
    laneType: 'rewrite',
    provider: env.RAG_PROVIDER || '',
    apiKey: env.RAG_API_KEY || '',
    baseUrl: env.RAG_BASE_URL || '',
    upstreamModel: env.RAG_REWRITE_MODEL || '',
    endpointPath: env.RAG_CHAT_COMPLETIONS_PATH || '/chat/completions',
    pricingType: 'per_million_tokens',
    inputPricePerMillionUsd: 0,
    outputPricePerMillionUsd: 0,
  });

  maybePush({
    laneType: 'rerank',
    provider: env.RERANK_PROVIDER || '',
    apiKey: env.RERANK_API_KEY || '',
    baseUrl: env.RERANK_BASE_URL || '',
    upstreamModel: env.RERANK_MODEL || '',
    endpointPath: env.RERANK_PATH || '/chat/completions',
    pricingType: 'per_million_tokens',
    inputPricePerMillionUsd: 0,
    outputPricePerMillionUsd: 0,
  });

  return configs;
}

async function upsertProvider(config: LaneSeedConfig) {
  const slug = slugify(`${config.provider}-${config.baseUrl}`);
  return prisma.ai_providers.upsert({
    where: { slug },
    update: {
      name: config.provider,
      provider_kind: 'openai_compatible',
      base_url: config.baseUrl,
      api_key_encrypted: config.apiKey || null,
      is_active: true,
    },
    create: {
      name: config.provider,
      slug,
      provider_kind: 'openai_compatible',
      base_url: config.baseUrl,
      api_key_encrypted: config.apiKey || null,
      is_active: true,
    },
  });
}

async function upsertEndpoint(providerId: string, config: LaneSeedConfig) {
  await prisma.ai_provider_endpoints.upsert({
    where: {
      provider_id_lane_type_endpoint_path: {
        provider_id: providerId,
        lane_type: config.laneType,
        endpoint_path: config.endpointPath,
      },
    },
    update: { is_default: true },
    create: {
      provider_id: providerId,
      lane_type: config.laneType,
      endpoint_path: config.endpointPath,
      is_default: true,
    },
  });
}

async function upsertModel(providerId: string, config: LaneSeedConfig, upstreamModelName: string) {
  return prisma.ai_models.upsert({
    where: {
      provider_id_lane_type_upstream_model_name: {
        provider_id: providerId,
        lane_type: config.laneType,
        upstream_model_name: upstreamModelName,
      },
    },
    update: {
      display_name: laneDisplayName(config.laneType, upstreamModelName),
      endpoint_path: config.endpointPath,
      actual_pricing_type: config.pricingType,
      actual_fixed_price_usd: config.fixedPriceUsd ?? null,
      actual_input_price_per_million_usd: config.inputPricePerMillionUsd ?? null,
      actual_output_price_per_million_usd: config.outputPricePerMillionUsd ?? null,
      adjusted_pricing_type: config.pricingType,
      adjusted_fixed_price_usd: config.fixedPriceUsd ?? null,
      adjusted_input_price_per_million_usd: config.inputPricePerMillionUsd ?? null,
      adjusted_output_price_per_million_usd: config.outputPricePerMillionUsd ?? null,
      is_active: true,
      is_publicly_selectable: true,
      notes: 'Seeded from legacy env configuration',
    },
    create: {
      provider_id: providerId,
      lane_type: config.laneType,
      display_name: laneDisplayName(config.laneType, upstreamModelName),
      upstream_model_name: upstreamModelName,
      endpoint_path: config.endpointPath,
      actual_pricing_type: config.pricingType,
      actual_fixed_price_usd: config.fixedPriceUsd ?? null,
      actual_input_price_per_million_usd: config.inputPricePerMillionUsd ?? null,
      actual_output_price_per_million_usd: config.outputPricePerMillionUsd ?? null,
      adjusted_pricing_type: config.pricingType,
      adjusted_fixed_price_usd: config.fixedPriceUsd ?? null,
      adjusted_input_price_per_million_usd: config.inputPricePerMillionUsd ?? null,
      adjusted_output_price_per_million_usd: config.outputPricePerMillionUsd ?? null,
      is_active: true,
      is_publicly_selectable: true,
      notes: 'Seeded from legacy env configuration',
    },
  });
}

async function main() {
  const laneConfigs = parseLaneSeedConfigs();

  for (const config of laneConfigs) {
    const provider = await upsertProvider(config);
    await upsertEndpoint(provider.id, config);

    const primaryModel = await upsertModel(provider.id, config, config.upstreamModel);
    const fallbackModel = config.fallbackModel
      ? await upsertModel(provider.id, config, config.fallbackModel)
      : null;

    await prisma.ai_lane_assignments.upsert({
      where: {
        lane_type_village_id_is_global_default: {
          lane_type: config.laneType,
          village_id: null,
          is_global_default: true,
        },
      },
      update: {
        primary_model_id: primaryModel.id,
        fallback_model_id: fallbackModel?.id ?? null,
      },
      create: {
        lane_type: config.laneType,
        primary_model_id: primaryModel.id,
        fallback_model_id: fallbackModel?.id ?? null,
        village_id: null,
        is_global_default: true,
      },
    });
  }

  console.log(`Seeded ${laneConfigs.length} AI lane configurations from env.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
