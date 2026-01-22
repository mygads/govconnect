import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

// GET - List conversations
export async function GET(request: NextRequest) {
  const auth = await requireVillageAdmin(request);
  if (isNextResponse(auth)) return auth;

  try {
    const villageId = await getVillageIdFromUser(auth.userId);
    if (!villageId) {
      return NextResponse.json(
        { success: false, error: 'Desa tidak ditemukan' },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const channel = searchParams.get('channel');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    const where: any = { village_id: villageId };
    
    if (status) {
      where.status = status;
    }
    
    if (channel) {
      where.channel = channel;
    }

    const [conversations, total] = await Promise.all([
      prisma.conversations.findMany({
        where,
        include: {
          messages: {
            orderBy: { created_at: 'desc' },
            take: 1
          },
          _count: {
            select: { messages: true }
          }
        },
        orderBy: { last_message_at: 'desc' },
        skip,
        take: limit
      }),
      prisma.conversations.count({ where })
    ]);

    return NextResponse.json({
      success: true,
      data: conversations,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get conversations error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}
