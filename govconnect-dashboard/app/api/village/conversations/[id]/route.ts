import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

// GET - Detail conversation with messages
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const skip = (page - 1) * limit;

    const conversation = await prisma.conversations.findFirst({
      where: { id, village_id: villageId }
    });

    if (!conversation) {
      return NextResponse.json(
        { success: false, error: 'Percakapan tidak ditemukan' },
        { status: 404 }
      );
    }

    const [messages, totalMessages] = await Promise.all([
      prisma.messages.findMany({
        where: { conversation_id: id },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit
      }),
      prisma.messages.count({ where: { conversation_id: id } })
    ]);

    return NextResponse.json({
      success: true,
      data: {
        ...conversation,
        messages: messages.reverse(), // Return in chronological order
        pagination: {
          page,
          limit,
          total: totalMessages,
          totalPages: Math.ceil(totalMessages / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get conversation error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}

// PUT - Update conversation status (close/reopen)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    const existing = await prisma.conversations.findFirst({
      where: { id, village_id: villageId }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Percakapan tidak ditemukan' },
        { status: 404 }
      );
    }

    const conversation = await prisma.conversations.update({
      where: { id },
      data: {
        status,
        ...(status === 'CLOSED' && { ended_at: new Date() })
      }
    });

    return NextResponse.json({
      success: true,
      message: status === 'CLOSED' ? 'Percakapan ditutup' : 'Percakapan dibuka kembali',
      data: conversation
    });

  } catch (error) {
    console.error('Update conversation error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal memperbarui percakapan' },
      { status: 500 }
    );
  }
}
