import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// GET - List layanan publik untuk desa
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ villageSlug: string }> }
) {
  try {
    const { villageSlug } = await params;

    const village = await prisma.villages.findFirst({
      where: { 
        short_name: villageSlug
      }
    });

    if (!village) {
      return NextResponse.json(
        { success: false, error: 'Desa tidak ditemukan' },
        { status: 404 }
      );
    }

    const categories = await prisma.service_categories.findMany({
      where: { 
        village_id: village.id,
        is_active: true
      },
      include: {
        services: {
          where: { is_active: true },
          orderBy: { order: 'asc' },
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            processing_time: true,
            delivery_method: true
          }
        }
      },
      orderBy: { order: 'asc' }
    });

    // Filter out empty categories
    const filteredCategories = categories.filter(cat => cat.services.length > 0);

    return NextResponse.json({
      success: true,
      data: {
        village: {
          name: village.name,
          short_name: village.short_name
        },
        categories: filteredCategories
      }
    });

  } catch (error) {
    console.error('Get public services error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}
