import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

// GET - List kategori layanan
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

    const categories = await prisma.service_categories.findMany({
      where: { village_id: villageId },
      include: {
        _count: {
          select: { services: true }
        }
      },
      orderBy: { order: 'asc' }
    });

    return NextResponse.json({
      success: true,
      data: categories
    });

  } catch (error) {
    console.error('Get service categories error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}

// POST - Buat kategori layanan baru
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
    const { name, description, icon } = body;

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Nama kategori wajib diisi' },
        { status: 400 }
      );
    }

    const lastCategory = await prisma.service_categories.findFirst({
      where: { village_id: villageId },
      orderBy: { order: 'desc' }
    });

    const category = await prisma.service_categories.create({
      data: {
        village_id: villageId,
        name,
        description,
        icon,
        order: (lastCategory?.order || 0) + 1
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Kategori layanan berhasil dibuat',
      data: category
    });

  } catch (error) {
    console.error('Create service category error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal membuat kategori' },
      { status: 500 }
    );
  }
}
