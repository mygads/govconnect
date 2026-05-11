import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { buildUrl, requireInternalApiKey, ServicePath } from '@/lib/api-client';

type ChannelAccountListItem = {
  village_id: string;
  enabled_webchat: boolean;
};

export async function GET() {
  try {
    const internalApiKey = requireInternalApiKey();

    if (!process.env['CHANNEL_SERVICE_URL']?.trim() && !process.env['API_BASE_URL']?.trim()) {
      return NextResponse.json(
        { success: false, error: 'CHANNEL_SERVICE_URL is not configured', code: 'SERVICE_URL_MISSING' },
        { status: 503 },
      );
    }

    const channelUrl = buildUrl(ServicePath.CHANNEL, '/internal/channel-accounts?enabled_webchat=true');
    const channelResp = await fetch(channelUrl, {
      headers: {
        'x-internal-api-key': internalApiKey,
      },
      cache: 'no-store',
    });

    if (!channelResp.ok) {
      const upstream = await channelResp.json().catch(() => null);
      return NextResponse.json(
        {
          success: false,
          error: upstream?.error || 'Failed to fetch webchat villages',
          code: 'UPSTREAM_UNAVAILABLE',
        },
        { status: channelResp.status },
      );
    }

    const channelJson = await channelResp.json();
    const channelAccounts: ChannelAccountListItem[] = Array.isArray(channelJson?.data)
      ? channelJson.data
      : [];

    const enabledVillageIds = channelAccounts
      .filter((a) => a?.enabled_webchat)
      .map((a) => a.village_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (enabledVillageIds.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const villages = await prisma.villages.findMany({
      where: {
        id: { in: enabledVillageIds },
        is_active: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return NextResponse.json({ success: true, data: villages });
  } catch (error) {
    console.error('Public webchat villages error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch webchat villages', code: 'UPSTREAM_UNAVAILABLE' },
      { status: 503 },
    );
  }
}
