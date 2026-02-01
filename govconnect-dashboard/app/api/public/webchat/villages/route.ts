import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { API_BASE_URL, buildUrl, CHANNEL_SERVICE_URL, INTERNAL_API_KEY, ServicePath } from '@/lib/api-client';

type ChannelAccountListItem = {
  village_id: string;
  enabled_webchat?: boolean | null;
};

export async function GET() {
  try {
    // Ensure routing to Channel Service is configured.
    // Without this, buildUrl() may produce a relative URL (e.g. /channel/...) which will 404.
    if (!CHANNEL_SERVICE_URL && !API_BASE_URL) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Konfigurasi belum lengkap: CHANNEL_SERVICE_URL atau API_BASE_URL belum diset. Tidak dapat memuat daftar desa untuk Webchat.',
        },
        { status: 500 }
      );
    }

    const channelUrl = buildUrl(ServicePath.CHANNEL, '/internal/channel-accounts');
    const channelResp = await fetch(channelUrl, {
      headers: {
        'x-internal-api-key': INTERNAL_API_KEY,
      },
      cache: 'no-store',
    });

    if (!channelResp.ok) {
      const status = channelResp.status;
      const isAuthError = status === 401 || status === 403;
      return NextResponse.json(
        {
          success: false,
          error: isAuthError
            ? 'Tidak dapat mengakses Channel Service: INTERNAL_API_KEY tidak valid atau tidak cocok.'
            : `Gagal mengambil channel accounts dari Channel Service (HTTP ${status}).`,
        },
        { status: 502 }
      );
    }

    const channelJson = await channelResp.json();
    const channelAccounts: ChannelAccountListItem[] = Array.isArray(channelJson?.data)
      ? channelJson.data
      : [];

    // Treat missing channel settings as enabled by default.
    // Only villages explicitly marked enabled_webchat=false are excluded.
    const enabledByVillageId = new Map<string, boolean>();
    for (const account of channelAccounts) {
      if (typeof account?.village_id === 'string' && account.village_id.length > 0) {
        enabledByVillageId.set(account.village_id, account.enabled_webchat !== false);
      }
    }

    const villages = await prisma.villages.findMany({
      where: {
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

    const enabledVillages = villages.filter((v) => enabledByVillageId.get(v.id) !== false);
    return NextResponse.json({ success: true, data: enabledVillages });
  } catch (error) {
    console.error('Public webchat villages error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Terjadi kesalahan saat memuat daftar desa untuk Webchat.',
      },
      { status: 500 }
    );
  }
}
