import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET - Detail knowledge text
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireVillageAdmin(request);
  if (isNextResponse(auth)) return auth;

  try {
    const { id } = await params;
    const villageId = await getVillageIdFromUser(auth.userId);
    if (!villageId) {
      return NextResponse.json(
        { success: false, error: 'Desa tidak ditemukan' },
        { status: 404 }
      );
    }
    
    const text = await prisma.knowledge_texts.findFirst({
      where: { 
        id,
        village_id: villageId 
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            type: true
          }
        }
      }
    });

    if (!text) {
      return NextResponse.json(
        { success: false, error: 'Data tidak ditemukan' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: text
    });

  } catch (error) {
    console.error('Get knowledge text error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}

// PUT - Update knowledge text
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireVillageAdmin(request);
  if (isNextResponse(auth)) return auth;

  try {
    const { id } = await params;
    const villageId = await getVillageIdFromUser(auth.userId);
    if (!villageId) {
      return NextResponse.json(
        { success: false, error: 'Desa tidak ditemukan' },
        { status: 404 }
      );
    }
    const body = await request.json();
    const { title, content, keywords, is_active, order } = body;

    // Pastikan data milik village ini
    const existing = await prisma.knowledge_texts.findFirst({
      where: { id, village_id: villageId }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Data tidak ditemukan' },
        { status: 404 }
      );
    }

    const text = await prisma.knowledge_texts.update({
      where: { id },
      data: {
        title,
        content,
        keywords,
        is_active,
        order
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            type: true
          }
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Knowledge base berhasil diperbarui',
      data: text
    });

  } catch (error) {
    console.error('Update knowledge text error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal memperbarui data' },
      { status: 500 }
    );
  }
}

// DELETE - Hapus knowledge text
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireVillageAdmin(request);
  if (isNextResponse(auth)) return auth;

  try {
    const { id } = await params;
    const villageId = await getVillageIdFromUser(auth.userId);
    if (!villageId) {
      return NextResponse.json(
        { success: false, error: 'Desa tidak ditemukan' },
        { status: 404 }
      );
    }

    // Pastikan data milik village ini
    const existing = await prisma.knowledge_texts.findFirst({
      where: { id, village_id: villageId }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Data tidak ditemukan' },
        { status: 404 }
      );
    }

    await prisma.knowledge_texts.delete({
      where: { id }
    });

    return NextResponse.json({
      success: true,
      message: 'Knowledge base berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete knowledge text error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menghapus data' },
      { status: 500 }
    );
  }
}
