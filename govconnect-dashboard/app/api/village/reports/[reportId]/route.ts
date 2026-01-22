import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

// GET - Detail laporan
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
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

    const { reportId } = await params;

    const report = await prisma.reports.findFirst({
      where: { id: reportId, village_id: villageId },
      include: {
        type: {
          include: {
            category: true,
            important_numbers: {
              include: {
                important_number: true
              }
            }
          }
        },
        responses: {
          orderBy: { created_at: 'desc' }
        }
      }
    });

    if (!report) {
      return NextResponse.json(
        { success: false, error: 'Laporan tidak ditemukan' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: report
    });

  } catch (error) {
    console.error('Get report error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}

// PUT - Update status laporan
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
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

    const { reportId } = await params;
    const body = await request.json();
    const { status, is_urgent } = body;

    const existing = await prisma.reports.findFirst({
      where: { id: reportId, village_id: villageId }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Laporan tidak ditemukan' },
        { status: 404 }
      );
    }

    const updateData: any = {};
    
    if (status) {
      updateData.status = status;
      if (status === 'RESOLVED') {
        updateData.resolved_at = new Date();
      }
    }
    
    if (is_urgent !== undefined) {
      updateData.is_urgent = is_urgent;
    }

    const report = await prisma.reports.update({
      where: { id: reportId },
      data: updateData,
      include: {
        type: {
          include: {
            category: true
          }
        },
        responses: {
          orderBy: { created_at: 'desc' }
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Laporan berhasil diperbarui',
      data: report
    });

  } catch (error) {
    console.error('Update report error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal memperbarui laporan' },
      { status: 500 }
    );
  }
}
