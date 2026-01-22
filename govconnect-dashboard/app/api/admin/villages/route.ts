import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireSuperAdmin, isNextResponse } from '@/lib/auth-middleware';

// GET - List semua desa (super admin only)
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (isNextResponse(auth)) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    const where: any = {};
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { kecamatan: { contains: search, mode: 'insensitive' } },
        { kabupaten: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [villages, total] = await Promise.all([
      prisma.villages.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true
            }
          },
          _count: {
            select: {
              service_categories: true,
              service_requests: true,
              reports: true,
              conversations: true
            }
          }
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit
      }),
      prisma.villages.count({ where })
    ]);

    return NextResponse.json({
      success: true,
      data: villages,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get villages error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}
