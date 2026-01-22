import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

// GET - Detail kategori
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

    const category = await prisma.service_categories.findFirst({
      where: { id, village_id: villageId },
      include: {
        services: {
          where: { is_active: true },
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
    console.error('Get service category error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}

// PUT - Update kategori
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
    const { name, description, icon, order, is_active } = body;

    const existing = await prisma.service_categories.findFirst({
      where: { id, village_id: villageId }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Kategori tidak ditemukan' },
        { status: 404 }
      );
    }

    const category = await prisma.service_categories.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(icon !== undefined && { icon }),
        ...(order !== undefined && { order }),
        ...(is_active !== undefined && { is_active })
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Kategori berhasil diperbarui',
      data: category
    });

  } catch (error) {
    console.error('Update service category error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal memperbarui kategori' },
      { status: 500 }
    );
  }
}

// DELETE - Hapus kategori
export async function DELETE(
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

    const existing = await prisma.service_categories.findFirst({
      where: { id, village_id: villageId },
      include: {
        services: true
      }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Kategori tidak ditemukan' },
        { status: 404 }
      );
    }

    if (existing.services.length > 0) {
      return NextResponse.json(
        { success: false, error: 'Tidak dapat menghapus kategori yang masih memiliki layanan' },
        { status: 400 }
      );
    }

    await prisma.service_categories.delete({
      where: { id }
    });

    return NextResponse.json({
      success: true,
      message: 'Kategori berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete service category error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menghapus kategori' },
      { status: 500 }
    );
  }
}
