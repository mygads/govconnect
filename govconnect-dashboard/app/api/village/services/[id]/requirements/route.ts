import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

// GET - List persyaratan layanan
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

    const { id: serviceId } = await params;

    // Verify service belongs to village
    const service = await prisma.services.findFirst({
      where: { id: serviceId, village_id: villageId }
    });

    if (!service) {
      return NextResponse.json(
        { success: false, error: 'Layanan tidak ditemukan' },
        { status: 404 }
      );
    }

    const requirements = await prisma.service_requirements.findMany({
      where: { service_id: serviceId },
      orderBy: { order: 'asc' }
    });

    return NextResponse.json({
      success: true,
      data: requirements
    });

  } catch (error) {
    console.error('Get service requirements error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}

// POST - Tambah persyaratan baru
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

    const { id: serviceId } = await params;
    const body = await request.json();
    const { 
      name, 
      type = 'FILE', 
      description, 
      is_required = true,
      file_types,
      accepted_file_types,
      max_file_size,
      options
    } = body;

    // Verify service belongs to village
    const service = await prisma.services.findFirst({
      where: { id: serviceId, village_id: villageId }
    });

    if (!service) {
      return NextResponse.json(
        { success: false, error: 'Layanan tidak ditemukan' },
        { status: 404 }
      );
    }

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Nama persyaratan wajib diisi' },
        { status: 400 }
      );
    }

    const lastReq = await prisma.service_requirements.findFirst({
      where: { service_id: serviceId },
      orderBy: { order: 'desc' }
    });

    const requirement = await prisma.service_requirements.create({
      data: {
        service_id: serviceId,
        name,
        type,
        description,
        is_required,
        accepted_file_types: file_types || accepted_file_types,
        max_file_size,
        options,
        order: (lastReq?.order || 0) + 1
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Persyaratan berhasil ditambahkan',
      data: requirement
    });

  } catch (error) {
    console.error('Create service requirement error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menambahkan persyaratan' },
      { status: 500 }
    );
  }
}

// PUT - Bulk update persyaratan (untuk reorder)
export async function PUT(
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

    const { id: serviceId } = await params;
    const body = await request.json();
    const { requirements } = body;

    // Verify service belongs to village
    const service = await prisma.services.findFirst({
      where: { id: serviceId, village_id: villageId }
    });

    if (!service) {
      return NextResponse.json(
        { success: false, error: 'Layanan tidak ditemukan' },
        { status: 404 }
      );
    }

    if (!Array.isArray(requirements)) {
      return NextResponse.json(
        { success: false, error: 'Data persyaratan tidak valid' },
        { status: 400 }
      );
    }

    // Update order for each requirement
    await prisma.$transaction(
      requirements.map((req: { id: string; order: number }) =>
        prisma.service_requirements.update({
          where: { id: req.id },
          data: { order: req.order }
        })
      )
    );

    const updatedRequirements = await prisma.service_requirements.findMany({
      where: { service_id: serviceId },
      orderBy: { order: 'asc' }
    });

    return NextResponse.json({
      success: true,
      message: 'Urutan persyaratan berhasil diperbarui',
      data: updatedRequirements
    });

  } catch (error) {
    console.error('Update service requirements order error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal memperbarui urutan' },
      { status: 500 }
    );
  }
}
