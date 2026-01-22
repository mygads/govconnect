import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse } from '@/lib/auth-middleware';

// GET - Dapatkan settings channel
export async function GET(request: NextRequest) {
  const auth = await requireVillageAdmin(request);
  if (isNextResponse(auth)) return auth;

  try {
    const village = await prisma.villages.findUnique({
      where: { user_id: auth.userId },
      select: {
        id: true,
        short_name: true,
        whatsapp_enabled: true,
        whatsapp_token: true,
        whatsapp_number: true,
        whatsapp_webhook_url: true,
        webchat_enabled: true,
        ai_enabled: true,
        ai_greeting: true
      }
    });

    if (!village) {
      return NextResponse.json(
        { success: false, error: 'Desa tidak ditemukan' },
        { status: 404 }
      );
    }

    // Generate webhook URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const webhookUrl = `${baseUrl}/api/webhook/whatsapp/${village.short_name}`;

    return NextResponse.json({
      success: true,
      data: {
        ...village,
        webhook_url: webhookUrl,
        webchat_embed_code: village.webchat_enabled 
          ? `<script src="${baseUrl}/embed/webchat.js" data-village="${village.short_name}"></script>`
          : null
      }
    });

  } catch (error) {
    console.error('Get channel settings error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil settings channel' },
      { status: 500 }
    );
  }
}

// PUT - Update settings channel
export async function PUT(request: NextRequest) {
  const auth = await requireVillageAdmin(request);
  if (isNextResponse(auth)) return auth;

  try {
    const body = await request.json();
    const {
      whatsapp_enabled,
      whatsapp_token,
      whatsapp_number,
      webchat_enabled,
      ai_enabled,
      ai_greeting
    } = body;

    const village = await prisma.villages.update({
      where: { user_id: auth.userId },
      data: {
        whatsapp_enabled,
        whatsapp_token,
        whatsapp_number,
        webchat_enabled,
        ai_enabled,
        ai_greeting
      },
      select: {
        id: true,
        short_name: true,
        whatsapp_enabled: true,
        whatsapp_token: true,
        whatsapp_number: true,
        webchat_enabled: true,
        ai_enabled: true,
        ai_greeting: true
      }
    });

    // Generate webhook URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const webhookUrl = `${baseUrl}/api/webhook/whatsapp/${village.short_name}`;

    return NextResponse.json({
      success: true,
      message: 'Settings channel berhasil diperbarui',
      data: {
        ...village,
        webhook_url: webhookUrl
      }
    });

  } catch (error) {
    console.error('Update channel settings error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal memperbarui settings channel' },
      { status: 500 }
    );
  }
}
