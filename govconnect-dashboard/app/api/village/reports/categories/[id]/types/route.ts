import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

// GET - List jenis pengaduan dalam kategori
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

    const { id: categoryId } = await params;

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

    const types = await prisma.report_types.findMany({
      where: { category_id: categoryId },
      include: {
        important_numbers: {
          include: {
            important_number: true
          }
        },
        _count: {
          select: { reports: true }
        }
      },
      orderBy: { order: 'asc' }
    });

    return NextResponse.json({
      success: true,
      data: types
    });

  } catch (error) {
    console.error('Get report types error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}

// POST - Buat jenis pengaduan baru
export async function POST(
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

    const { id: categoryId } = await params;
    const body = await request.json();
    const { 
      name, 
      description, 
      is_urgent = false,
      requires_address = true,
      requires_photo = false,
      send_number_to_user = false,
      auto_response,
      important_number_ids = [] // IDs of important numbers to link
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

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Nama jenis pengaduan wajib diisi' },
        { status: 400 }
      );
    }

    const lastType = await prisma.report_types.findFirst({
      where: { category_id: categoryId },
      orderBy: { order: 'desc' }
    });

    const reportType = await prisma.$transaction(async (tx) => {
      const newType = await tx.report_types.create({
        data: {
          category_id: categoryId,
          name,
          description,
          is_urgent,
          requires_address,
          requires_photo,
          send_number_to_user,
          auto_response,
          order: (lastType?.order || 0) + 1
        }
      });

      // Link important numbers if provided
      if (important_number_ids.length > 0) {
        await tx.report_type_numbers.createMany({
          data: important_number_ids.map((numberId: string) => ({
            report_type_id: newType.id,
            important_number_id: numberId
          }))
        });
      }

      return tx.report_types.findUnique({
        where: { id: newType.id },
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
      message: 'Jenis pengaduan berhasil dibuat',
      data: reportType
    });

  } catch (error) {
    console.error('Create report type error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal membuat jenis pengaduan' },
      { status: 500 }
    );
  }
}
