/**
 * Feature Flags — strangler-pattern rollout for the v2 pipeline.
 *
 * Modes per tenant:
 * - 'off'    : v1 path only (default). Zero behavior change.
 * - 'shadow' : v1 serves the citizen; v2 runs in the background and its
 *              result is logged for comparison. No citizen impact.
 * - 'on'     : v2 serves the citizen.
 *
 * Precedence: per-tenant override (env JSON) > global env > 'off'.
 */

export type PipelineMode = 'off' | 'shadow' | 'on';

function parseTenantOverrides(): Record<string, PipelineMode> {
  try {
    const raw = process.env.PIPELINE_TENANT_OVERRIDES ?? '{}';
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: Record<string, PipelineMode> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === 'off' || v === 'shadow' || v === 'on') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function getPipelineMode(tenantId?: string | null): PipelineMode {
  if (tenantId) {
    const overrides = parseTenantOverrides();
    const hit = overrides[tenantId];
    if (hit) return hit;
  }
  const global = (process.env.PIPELINE_MODE ?? 'off').toLowerCase();
  if (global === 'shadow' || global === 'on') return global;
  return 'off';
}

export function isV2Enabled(tenantId?: string | null): boolean {
  return getPipelineMode(tenantId) === 'on';
}

export function isShadowEnabled(tenantId?: string | null): boolean {
  return getPipelineMode(tenantId) === 'shadow';
}
