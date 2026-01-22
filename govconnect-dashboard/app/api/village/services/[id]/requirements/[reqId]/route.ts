import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

// GET - Detail persyaratan
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; reqId: string }> }
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

    const { id: serviceId, reqId } = await params;

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

    const requirement = await prisma.service_requirements.findFirst({
      where: { id: reqId, service_id: serviceId }
    });

    if (!requirement) {
      return NextResponse.json(
        { success: false, error: 'Persyaratan tidak ditemukan' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: requirement
    });

  } catch (error) {
    console.error('Get service requirement error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}

// PUT - Update persyaratan
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; reqId: string }> }
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

    const { id: serviceId, reqId } = await params;
    const body = await request.json();
    const { 
      name, 
      type, 
      description, 
      is_required,
      file_types,
      max_file_size,
      options,
      order
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

    const existing = await prisma.service_requirements.findFirst({
      where: { id: reqId, service_id: serviceId }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Persyaratan tidak ditemukan' },
        { status: 404 }
      );
    }

    const requirement = await prisma.service_requirements.update({
      where: { id: reqId },
      data: {
        ...(name && { name }),
        ...(type && { type }),
        ...(description !== undefined && { description }),
        ...(is_required !== undefined && { is_required }),
        ...(file_types !== undefined && { file_types }),
        ...(max_file_size !== undefined && { max_file_size }),
        ...(options !== undefined && { options }),
        ...(order !== undefined && { order })
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Persyaratan berhasil diperbarui',
      data: requirement
    });

  } catch (error) {
    console.error('Update service requirement error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal memperbarui persyaratan' },
      { status: 500 }
    );
  }
}

// DELETE - Hapus persyaratan
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; reqId: string }> }
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

    const { id: serviceId, reqId } = await params;

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

    const existing = await prisma.service_requirements.findFirst({
      where: { id: reqId, service_id: serviceId }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Persyaratan tidak ditemukan' },
        { status: 404 }
      );
    }

    await prisma.service_requirements.delete({
      where: { id: reqId }
    });

    return NextResponse.json({
      success: true,
      message: 'Persyaratan berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete service requirement error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menghapus persyaratan' },
      { status: 500 }
    );
  }
}
