import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

// GET - Detail permohonan
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

    const { id } = await params;

    const serviceRequest = await prisma.service_requests.findFirst({
      where: { id, village_id: villageId },
      include: {
        service: {
          include: {
            category: true,
            requirements: {
              orderBy: { order: 'asc' }
            }
          }
        },
        requirements: {
          include: {
            requirement: true
          },
          orderBy: { requirement: { order: 'asc' } }
        },
        status_history: {
          orderBy: { created_at: 'desc' }
        }
      }
    });

    if (!serviceRequest) {
      return NextResponse.json(
        { success: false, error: 'Permohonan tidak ditemukan' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: serviceRequest
    });

  } catch (error) {
    console.error('Get service request error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}

// PUT - Update status permohonan
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

    const { id } = await params;
    const body = await request.json();
    const { status, admin_notes, reject_reason } = body;

    const existing = await prisma.service_requests.findFirst({
      where: { id, village_id: villageId }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Permohonan tidak ditemukan' },
        { status: 404 }
      );
    }

    // Validate status transition - ServiceRequestStatus enum: PENDING, IN_PROGRESS, COMPLETED, REJECTED, CANCELLED
    const validTransitions: Record<string, string[]> = {
      'PENDING': ['IN_PROGRESS', 'REJECTED', 'CANCELLED'],
      'IN_PROGRESS': ['COMPLETED', 'REJECTED', 'CANCELLED'],
      'COMPLETED': [],
      'REJECTED': [],
      'CANCELLED': []
    };

    if (status && !validTransitions[existing.status]?.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Tidak dapat mengubah status dari ${existing.status} ke ${status}` },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const updateData: any = {};
      
      if (status) {
        updateData.status = status;
        if (status === 'COMPLETED') {
          updateData.completed_at = new Date();
        }
      }
      
      if (admin_notes !== undefined) {
        updateData.admin_notes = admin_notes;
      }
      
      if (reject_reason) {
        updateData.reject_reason = reject_reason;
      }

      // Update request
      const serviceRequest = await tx.service_requests.update({
        where: { id },
        data: updateData
      });

      // Add status history
      if (status) {
        await tx.service_request_status_history.create({
          data: {
            request_id: id,
            status,
            created_by: auth.name || 'Admin Desa',
            notes: admin_notes || reject_reason
          }
        });
      }

      return serviceRequest;
    });

    // TODO: Send notification to applicant

    return NextResponse.json({
      success: true,
      message: 'Status permohonan berhasil diperbarui',
      data: result
    });

  } catch (error) {
    console.error('Update service request error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal memperbarui permohonan' },
      { status: 500 }
    );
  }
}
