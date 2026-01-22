import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// GET - Detail layanan untuk form publik
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ villageSlug: string; serviceSlug: string }> }
) {
  try {
    const { villageSlug, serviceSlug } = await params;

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

    const service = await prisma.services.findFirst({
      where: { 
        slug: serviceSlug,
        village_id: village.id,
        is_active: true
      },
      include: {
        category: {
          select: {
            id: true,
            name: true
          }
        },
        requirements: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            name: true,
            type: true,
            description: true,
            is_required: true,
            accepted_file_types: true,
            max_file_size: true,
            options: true,
            order: true
          }
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
      data: {
        village: {
          id: village.id,
          name: village.name,
          short_name: village.short_name,
          logo_url: village.logo_url,
          phone: village.phone,
          email: village.email
        },
        service
      }
    });

  } catch (error) {
    console.error('Get public service detail error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}
