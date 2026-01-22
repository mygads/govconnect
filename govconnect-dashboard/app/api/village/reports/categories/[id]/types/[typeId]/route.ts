import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

// GET - Detail jenis pengaduan
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; typeId: string }> }
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

    const { id: categoryId, typeId } = await params;

    // Verify category belongs to village
    const category = await prisma.report_categories.findFirst({
      where: { id: categoryId, village_id: villageId }
    });

    if (!category) {
      return NextResponse.json(
        { success: false, error: 'Kategori tidak ditemukan' },
        { status: 404 }
      );
    }

    const reportType = await prisma.report_types.findFirst({
      where: { id: typeId, category_id: categoryId },
      include: {
        important_numbers: {
          include: {
            important_number: true
          }
        },
        _count: {
          select: { reports: true }
        }
      }
    });

    if (!reportType) {
      return NextResponse.json(
        { success: false, error: 'Jenis pengaduan tidak ditemukan' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: reportType
    });

  } catch (error) {
    console.error('Get report type error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}

// PUT - Update jenis pengaduan
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; typeId: string }> }
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

    const { id: categoryId, typeId } = await params;
    const body = await request.json();
    const { 
      name, 
      description, 
      is_urgent,
      requires_address,
      requires_photo,
      send_number_to_user,
      auto_response,
      is_active,
      order,
      important_number_ids
    } = body;

    // Verify category belongs to village
    const category = await prisma.report_categories.findFirst({
      where: { id: categoryId, village_id: villageId }
    });

    if (!category) {
      return NextResponse.json(
        { success: false, error: 'Kategori tidak ditemukan' },
        { status: 404 }
      );
    }

    const existing = await prisma.report_types.findFirst({
      where: { id: typeId, category_id: categoryId }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Jenis pengaduan tidak ditemukan' },
        { status: 404 }
      );
    }

    const reportType = await prisma.$transaction(async (tx) => {
      const updated = await tx.report_types.update({
        where: { id: typeId },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(is_urgent !== undefined && { is_urgent }),
          ...(requires_address !== undefined && { requires_address }),
          ...(requires_photo !== undefined && { requires_photo }),
          ...(send_number_to_user !== undefined && { send_number_to_user }),
          ...(auto_response !== undefined && { auto_response }),
          ...(is_active !== undefined && { is_active }),
          ...(order !== undefined && { order })
        }
      });

      // Update important numbers if provided
      if (important_number_ids !== undefined) {
        // Delete existing
        await tx.report_type_numbers.deleteMany({
          where: { report_type_id: typeId }
        });

        // Create new links
        if (important_number_ids.length > 0) {
          await tx.report_type_numbers.createMany({
            data: important_number_ids.map((numberId: string) => ({
              report_type_id: typeId,
              important_number_id: numberId
            }))
          });
        }
      }

      return tx.report_types.findUnique({
        where: { id: typeId },
        include: {
          important_numbers: {
            include: {
              important_number: true
            }
          }
        }
      });
    });

    return NextResponse.json({
      success: true,
      message: 'Jenis pengaduan berhasil diperbarui',
      data: reportType
    });

  } catch (error) {
    console.error('Update report type error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal memperbarui jenis pengaduan' },
      { status: 500 }
    );
  }
}

// DELETE - Hapus jenis pengaduan
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; typeId: string }> }
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

    const { id: categoryId, typeId } = await params;

    // Verify category belongs to village
    const category = await prisma.report_categories.findFirst({
      where: { id: categoryId, village_id: villageId }
    });

    if (!category) {
      return NextResponse.json(
        { success: false, error: 'Kategori tidak ditemukan' },
        { status: 404 }
      );
    }

    const existing = await prisma.report_types.findFirst({
      where: { id: typeId, category_id: categoryId },
      include: {
        _count: {
          select: { reports: true }
        }
      }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Jenis pengaduan tidak ditemukan' },
        { status: 404 }
      );
    }

    if (existing._count.reports > 0) {
      // Soft delete
      await prisma.report_types.update({
        where: { id: typeId },
        data: { is_active: false }
      });

      return NextResponse.json({
        success: true,
        message: 'Jenis pengaduan dinonaktifkan (masih ada laporan terkait)'
      });
    }

    // Hard delete
    await prisma.report_types.delete({
      where: { id: typeId }
    });

    return NextResponse.json({
      success: true,
      message: 'Jenis pengaduan berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete report type error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menghapus jenis pengaduan' },
      { status: 500 }
    );
  }
}
