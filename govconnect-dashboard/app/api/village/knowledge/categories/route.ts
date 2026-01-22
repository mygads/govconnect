import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

// GET - List semua kategori knowledge base
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

    const categories = await prisma.knowledge_categories.findMany({
      where: { village_id: villageId },
      include: {
        files: {
          select: {
            id: true,
            original_name: true,
            mime_type: true,
            file_size: true,
            is_processed: true,
            created_at: true
          }
        },
        texts: {
          select: {
            id: true,
            title: true,
            is_active: true,
            created_at: true
          }
        },
        _count: {
          select: {
            files: true,
            texts: true
          }
        }
      },
      orderBy: { order: 'asc' }
    });

    return NextResponse.json({
      success: true,
      data: categories
    });

  } catch (error) {
    console.error('Get knowledge categories error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data kategori' },
      { status: 500 }
    );
  }
}

// POST - Buat kategori baru
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
    const { name, type, description, icon } = body;

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Nama kategori wajib diisi' },
        { status: 400 }
      );
    }

    // Dapatkan order terakhir
    const lastCategory = await prisma.knowledge_categories.findFirst({
      where: { village_id: villageId },
      orderBy: { order: 'desc' }
    });

    const category = await prisma.knowledge_categories.create({
      data: {
        village_id: villageId,
        name,
        type: type || 'CUSTOM',
        description,
        icon,
        order: (lastCategory?.order || 0) + 1,
        is_active: true
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Kategori berhasil dibuat',
      data: category
    });

  } catch (error) {
    console.error('Create knowledge category error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal membuat kategori' },
      { status: 500 }
    );
  }
}
