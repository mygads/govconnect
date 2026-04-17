/**
 * Complaint type resolver for Case Service.
 *
 * Case Service no longer talks to Gemini or any direct model provider.
 * It delegates semantic complaint-type matching to AI Service, which already
 * owns the gateway-only LLM integration and token accounting.
 */

import { config } from '../config/env';
import logger from '../utils/logger';

export interface MicroLLMMatch {
  matched_id: string | null;
  confidence: number;
  reason: string;
}

interface ComplaintTypeOption {
  id: string;
  name: string;
  category_name: string;
  is_urgent: boolean;
}

interface ComplaintTypeMatchResponse {
  matched_id?: string | null;
  confidence?: number;
  reason?: string;
}

export async function resolveWithMicroLLM(
  kategori: string,
  availableTypes: ComplaintTypeOption[],
  context?: { village_id?: string },
): Promise<MicroLLMMatch | null> {
  if (!kategori || !availableTypes.length) {
    return null;
  }

  try {
    const response = await fetch(`${config.aiServiceUrl}/admin/nlu/complaint-type-match`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': config.internalApiKey,
      },
      body: JSON.stringify({
        kategori,
        context,
        availableTypes: availableTypes.map((item) => ({
          id: item.id,
          name: item.name,
          category_name: item.category_name,
        })),
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`AI service ${response.status}: ${errorText || response.statusText}`);
    }

    const parsed = await response.json() as ComplaintTypeMatchResponse;
    if (typeof parsed.confidence !== 'number') {
      return null;
    }

    const matchedId = parsed.matched_id && availableTypes.some((item) => item.id === parsed.matched_id)
      ? parsed.matched_id
      : null;

    return {
      matched_id: matchedId,
      confidence: matchedId ? parsed.confidence : 0,
      reason: parsed.reason || 'no_match',
    };
  } catch (error: any) {
    logger.warn('Complaint type resolver via AI service failed', {
      kategori,
      error: error.message,
    });
    return null;
  }
}
