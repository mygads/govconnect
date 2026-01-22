import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';
import { generateSlug } from '@/lib/auth';

// GET - Detail layanan
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

    const service = await prisma.services.findFirst({
      where: { id, village_id: villageId },
      include: {
        category: true,
        requirements: {
          orderBy: { order: 'asc' }
        },
        _count: {
          select: { requests: true }
        }
      }
    });

    if (!service) {
      return NextResponse.json(
        { success: false, error: 'Layanan tidak ditemukan' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: service
    });

  } catch (error) {
    console.error('Get service error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}

// PUT - Update layanan
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
    const { 
      category_id,
      name, 
      description, 
      processing_time,
      cost,
      delivery_method,
      is_active,
      order
    } = body;

    const existing = await prisma.services.findFirst({
      where: { id, village_id: villageId }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Layanan tidak ditemukan' },
        { status: 404 }
      );
    }

    // If category changed, verify it belongs to village
    if (category_id && category_id !== existing.category_id) {
      const category = await prisma.service_categories.findFirst({
        where: { id: category_id, village_id: villageId }
      });
      if (!category) {
        return NextResponse.json(
          { success: false, error: 'Kategori tidak ditemukan' },
          { status: 404 }
        );
      }
    }

    // Generate new slug if name changed
    let newSlug = existing.slug;
    if (name && name !== existing.name) {
      newSlug = generateSlug(name);
      const existingSlug = await prisma.services.findFirst({
        where: { 
          village_id: villageId, 
          slug: newSlug,
          id: { not: id }
        }
      });
      if (existingSlug) {
        newSlug = `${newSlug}-${Date.now()}`;
      }
    }

    const service = await prisma.services.update({
      where: { id },
      data: {
        ...(category_id && { category_id }),
        ...(name && { name, slug: newSlug }),
        ...(description !== undefined && { description }),
        ...(processing_time !== undefined && { processing_time }),
        ...(cost !== undefined && { cost }),
        ...(delivery_method && { delivery_method }),
        ...(is_active !== undefined && { is_active }),
        ...(order !== undefined && { order })
      },
      include: {
        category: true,
        requirements: {
          orderBy: { order: 'asc' }
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Layanan berhasil diperbarui',
      data: service
    });

  } catch (error) {
    console.error('Update service error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal memperbarui layanan' },
      { status: 500 }
    );
  }
}

// DELETE - Hapus layanan
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

    const existing = await prisma.services.findFirst({
      where: { id, village_id: villageId },
      include: {
        _count: {
          select: { requests: true }
        }
      }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Layanan tidak ditemukan' },
        { status: 404 }
      );
    }

    if (existing._count.requests > 0) {
      // Soft delete - just deactivate
      await prisma.services.update({
        where: { id },
        data: { is_active: false }
      });

      return NextResponse.json({
        success: true,
        message: 'Layanan berhasil dinonaktifkan (masih ada permohonan terkait)'
      });
    }

    // Hard delete if no requests
    await prisma.services.delete({
      where: { id }
    });

    return NextResponse.json({
      success: true,
      message: 'Layanan berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete service error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menghapus layanan' },
      { status: 500 }
    );
  }
}
