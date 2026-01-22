import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

// GET - List nomor penting dalam kategori
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
    const category = await prisma.important_number_categories.findFirst({
      where: { id: categoryId, village_id: villageId }
    });

    if (!category) {
      return NextResponse.json(
        { success: false, error: 'Kategori tidak ditemukan' },
        { status: 404 }
      );
    }

    const numbers = await prisma.important_numbers.findMany({
      where: { category_id: categoryId },
      orderBy: { order: 'asc' }
    });

    return NextResponse.json({
      success: true,
      data: numbers
    });

  } catch (error) {
    console.error('Get important numbers error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}

// POST - Tambah nomor penting baru
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
    const { name, phone, description } = body;

    // Verify category belongs to village
    const category = await prisma.important_number_categories.findFirst({
      where: { id: categoryId, village_id: villageId }
    });

    if (!category) {
      return NextResponse.json(
        { success: false, error: 'Kategori tidak ditemukan' },
        { status: 404 }
      );
    }

    if (!name || !phone) {
      return NextResponse.json(
        { success: false, error: 'Nama dan nomor telepon wajib diisi' },
        { status: 400 }
      );
    }

    const lastNumber = await prisma.important_numbers.findFirst({
      where: { category_id: categoryId },
      orderBy: { order: 'desc' }
    });

    const number = await prisma.important_numbers.create({
      data: {
        category_id: categoryId,
        name,
        phone,
        description,
        order: (lastNumber?.order || 0) + 1
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Nomor penting berhasil ditambahkan',
      data: number
    });

  } catch (error) {
    console.error('Create important number error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menambahkan nomor' },
      { status: 500 }
    );
  }
}
