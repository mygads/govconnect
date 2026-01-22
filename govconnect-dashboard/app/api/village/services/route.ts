import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';
import { generateSlug } from '@/lib/auth';

// GET - List semua layanan
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
    const categoryId = searchParams.get('category_id');
    const isActive = searchParams.get('is_active');

    const services = await prisma.services.findMany({
      where: {
        village_id: villageId,
        ...(categoryId && { category_id: categoryId }),
        ...(isActive !== null && { is_active: isActive === 'true' })
      },
      include: {
        category: true,
        requirements: {
          orderBy: { order: 'asc' }
        },
        _count: {
          select: { requests: true }
        }
      },
      orderBy: [
        { category: { order: 'asc' } },
        { order: 'asc' }
      ]
    });

    return NextResponse.json({
      success: true,
      data: services
    });

  } catch (error) {
    console.error('Get services error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}

// POST - Buat layanan baru
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { 
      category_id, 
      name, 
      description, 
      processing_time,
      delivery_method,
      requirements = []
    } = body;

    if (!name || !category_id) {
      return NextResponse.json(
        { success: false, error: 'Nama layanan dan kategori wajib diisi' },
        { status: 400 }
      );
    }

    // Verify category belongs to village
    const category = await prisma.service_categories.findFirst({
      where: { id: category_id, village_id: villageId }
    });

    if (!category) {
      return NextResponse.json(
        { success: false, error: 'Kategori tidak ditemukan' },
        { status: 404 }
      );
    }

    // Generate unique slug
    let slug = generateSlug(name);
    const existingSlug = await prisma.services.findFirst({
      where: { village_id: villageId, slug }
    });
    if (existingSlug) {
      slug = `${slug}-${Date.now()}`;
    }

    // Get last order
    const lastService = await prisma.services.findFirst({
      where: { village_id: villageId, category_id },
      orderBy: { order: 'desc' }
    });

    // Create service with requirements
    const service = await prisma.$transaction(async (tx) => {
      const newService = await tx.services.create({
        data: {
          village_id: villageId,
          category_id,
          name,
          slug,
          description,
          processing_time,
          delivery_method: delivery_method || 'PICKUP',
          order: (lastService?.order || 0) + 1
        }
      });

      // Create requirements if provided
      if (requirements.length > 0) {
        await tx.service_requirements.createMany({
          data: requirements.map((req: any, index: number) => ({
            service_id: newService.id,
            name: req.name,
            type: req.type || 'FILE',
            description: req.description,
            is_required: req.is_required !== false,
            accepted_file_types: req.file_types || req.accepted_file_types,
            max_file_size: req.max_file_size,
            options: req.options,
            order: index + 1
          }))
        });
      }

      return tx.services.findUnique({
        where: { id: newService.id },
        include: {
          category: true,
          requirements: {
            orderBy: { order: 'asc' }
          }
        }
      });
    });

    return NextResponse.json({
      success: true,
      message: 'Layanan berhasil dibuat',
      data: service
    });

  } catch (error) {
    console.error('Create service error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal membuat layanan' },
      { status: 500 }
    );
  }
}
