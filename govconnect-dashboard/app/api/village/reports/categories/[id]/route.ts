import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

// GET - Detail kategori dengan jenis pengaduan
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

    const category = await prisma.report_categories.findFirst({
      where: { id, village_id: villageId },
      include: {
        types: {
          orderBy: { order: 'asc' },
          include: {
            important_numbers: {
              include: {
                important_number: true
              }
            }
          }
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
    console.error('Get report category error:', error);
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

    const existing = await prisma.report_categories.findFirst({
      where: { id, village_id: villageId }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Kategori tidak ditemukan' },
        { status: 404 }
      );
    }

    const category = await prisma.report_categories.update({
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
    console.error('Update report category error:', error);
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

    const existing = await prisma.report_categories.findFirst({
      where: { id, village_id: villageId },
      include: {
        types: true
      }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Kategori tidak ditemukan' },
        { status: 404 }
      );
    }

    if (existing.types.length > 0) {
      return NextResponse.json(
        { success: false, error: 'Tidak dapat menghapus kategori yang masih memiliki jenis pengaduan' },
        { status: 400 }
      );
    }

    await prisma.report_categories.delete({
      where: { id }
    });

    return NextResponse.json({
      success: true,
      message: 'Kategori berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete report category error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menghapus kategori' },
      { status: 500 }
    );
  }
}
