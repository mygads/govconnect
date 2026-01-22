import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET - Detail kategori
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
    
    const category = await prisma.knowledge_categories.findFirst({
      where: { 
        id,
        village_id: villageId 
      },
      include: {
        files: {
          orderBy: { created_at: 'desc' }
        },
        texts: {
          orderBy: { order: 'asc' }
        }
      }
    });

    if (!category) {
      return NextResponse.json(
        { success: false, error: 'Kategori tidak ditemukan' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: category
    });

  } catch (error) {
    console.error('Get knowledge category error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data kategori' },
      { status: 500 }
    );
  }
}

// PUT - Update kategori
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
    const { name, description, icon, is_active, order } = body;

    // Pastikan kategori milik village ini
    const existing = await prisma.knowledge_categories.findFirst({
      where: { id, village_id: villageId }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Kategori tidak ditemukan' },
        { status: 404 }
      );
    }

    const category = await prisma.knowledge_categories.update({
      where: { id },
      data: {
        name,
        description,
        icon,
        is_active,
        order
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Kategori berhasil diperbarui',
      data: category
    });

  } catch (error) {
    console.error('Update knowledge category error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal memperbarui kategori' },
      { status: 500 }
    );
  }
}

// DELETE - Hapus kategori
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

    // Pastikan kategori milik village ini
    const existing = await prisma.knowledge_categories.findFirst({
      where: { id, village_id: villageId }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Kategori tidak ditemukan' },
        { status: 404 }
      );
    }

    // Hapus kategori (cascade akan hapus files dan texts)
    await prisma.knowledge_categories.delete({
      where: { id }
    });

    return NextResponse.json({
      success: true,
      message: 'Kategori berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete knowledge category error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menghapus kategori' },
      { status: 500 }
    );
  }
}
