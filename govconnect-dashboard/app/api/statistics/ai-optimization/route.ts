import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/auth';
import { apiFetch, buildUrl, getHeaders, ServicePath } from '@/lib/api-client';

/**
 * GET /api/statistics/ai-optimization
 * Fetch AI optimization stats from AI Service
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const response = await apiFetch(buildUrl(ServicePath.AI, '/stats/optimization'), {
      method: 'GET',
      headers: getHeaders(),
      timeout: 10000,
    });

    const data = await response.json().catch(() => ({ error: 'Failed to read AI optimization stats' }));
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    console.error('Failed to fetch AI optimization stats:', error.message);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 },
    );
  }
}
