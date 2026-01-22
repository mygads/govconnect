import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

// GET - List semua knowledge texts
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

    const where: any = { village_id: villageId };
    if (categoryId) {
      where.category_id = categoryId;
    }

    const texts = await prisma.knowledge_texts.findMany({
      where,
      include: {
        category: {
          select: {
            id: true,
            name: true,
            type: true
          }
        }
      },
      orderBy: [
        { category_id: 'asc' },
        { order: 'asc' }
      ]
    });

    return NextResponse.json({
      success: true,
      data: texts
    });

  } catch (error) {
    console.error('Get knowledge texts error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}

// POST - Buat knowledge text baru
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
    const { category_id, title, content, keywords } = body;

    if (!category_id || !title || !content) {
      return NextResponse.json(
        { success: false, error: 'Kategori, judul, dan konten wajib diisi' },
        { status: 400 }
      );
    }

    // Verifikasi kategori milik village ini
    const category = await prisma.knowledge_categories.findFirst({
      where: { id: category_id, village_id: villageId }
    });

    if (!category) {
      return NextResponse.json(
        { success: false, error: 'Kategori tidak ditemukan' },
        { status: 404 }
      );
    }

    // Dapatkan order terakhir
    const lastText = await prisma.knowledge_texts.findFirst({
      where: { category_id },
      orderBy: { order: 'desc' }
    });

    const text = await prisma.knowledge_texts.create({
      data: {
        village_id: villageId,
        category_id,
        title,
        content,
        keywords: keywords || [],
        order: (lastText?.order || 0) + 1,
        is_active: true
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            type: true
          }
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Knowledge base berhasil ditambahkan',
      data: text
    });

  } catch (error) {
    console.error('Create knowledge text error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal membuat knowledge base' },
      { status: 500 }
    );
  }
}
