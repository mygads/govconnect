import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// GET - Get village info by slug (public)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ villageSlug: string }> }
) {
  try {
    const { villageSlug } = await params;

    const village = await prisma.villages.findFirst({
      where: { 
        short_name: villageSlug
      },
      select: {
        id: true,
        name: true,
        short_name: true,
        kecamatan: true,
        kabupaten: true,
        provinsi: true,
        address: true,
        phone: true,
        email: true,
        logo_url: true,
        ai_greeting: true,
        operating_hours: {
          orderBy: { day_of_week: 'asc' }
        }
      }
    });

    if (!village) {
      return NextResponse.json(
        { success: false, error: 'Desa tidak ditemukan' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: village
    });

  } catch (error) {
    console.error('Get village public info error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}
