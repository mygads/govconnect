import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

// GET - Detail nomor penting
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; numberId: string }> }
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

    const { id: categoryId, numberId } = await params;

    // Verify category belongs to village
    const category = await prisma.important_number_categories.findFirst({
      where: { id: categoryId, village_id: villageId }
    });

    if (!category) {
      return NextResponse.json(
        { success: false, error: 'Kategori tidak ditemukan' },
        { status: 404 }
      );
    }

    const number = await prisma.important_numbers.findFirst({
      where: { id: numberId, category_id: categoryId }
    });

    if (!number) {
      return NextResponse.json(
        { success: false, error: 'Nomor tidak ditemukan' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: number
    });

  } catch (error) {
    console.error('Get important number error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}

// PUT - Update nomor penting
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; numberId: string }> }
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

    const { id: categoryId, numberId } = await params;
    const body = await request.json();
    const { name, phone, description, is_active, order } = body;

    // Verify category belongs to village
    const category = await prisma.important_number_categories.findFirst({
      where: { id: categoryId, village_id: villageId }
    });

    if (!category) {
      return NextResponse.json(
        { success: false, error: 'Kategori tidak ditemukan' },
        { status: 404 }
      );
    }

    const existing = await prisma.important_numbers.findFirst({
      where: { id: numberId, category_id: categoryId }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Nomor tidak ditemukan' },
        { status: 404 }
      );
    }

    const number = await prisma.important_numbers.update({
      where: { id: numberId },
      data: {
        ...(name && { name }),
        ...(phone && { phone }),
        ...(description !== undefined && { description }),
        ...(is_active !== undefined && { is_active }),
        ...(order !== undefined && { order })
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Nomor penting berhasil diperbarui',
      data: number
    });

  } catch (error) {
    console.error('Update important number error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal memperbarui nomor' },
      { status: 500 }
    );
  }
}

// DELETE - Hapus nomor penting
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; numberId: string }> }
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

    const { id: categoryId, numberId } = await params;

    // Verify category belongs to village
    const category = await prisma.important_number_categories.findFirst({
      where: { id: categoryId, village_id: villageId }
    });

    if (!category) {
      return NextResponse.json(
        { success: false, error: 'Kategori tidak ditemukan' },
        { status: 404 }
      );
    }

    const existing = await prisma.important_numbers.findFirst({
      where: { id: numberId, category_id: categoryId }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Nomor tidak ditemukan' },
        { status: 404 }
      );
    }

    await prisma.important_numbers.delete({
      where: { id: numberId }
    });

    return NextResponse.json({
      success: true,
      message: 'Nomor penting berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete important number error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menghapus nomor' },
      { status: 500 }
    );
  }
}
