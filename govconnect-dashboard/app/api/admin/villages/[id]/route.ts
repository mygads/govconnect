import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireSuperAdmin, isNextResponse } from '@/lib/auth-middleware';

// GET - Detail desa
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(request);
  if (isNextResponse(auth)) return auth;

  try {
    const { id } = await params;

    const village = await prisma.villages.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            created_at: true
          }
        },
        operating_hours: {
          orderBy: { day_of_week: 'asc' }
        },
        _count: {
          select: {
            service_categories: true,
            service_requests: true,
            reports: true,
            conversations: true,
            knowledge_categories: true,
            important_number_categories: true
          }
        }
      }
    });

    if (!village) {
      return NextResponse.json(
        { success: false, error: 'Desa tidak ditemukan' },
        { status: 404 }
      );
    }

    // Get additional stats
    const [
      pendingRequests,
      pendingReports,
      activeConversations
    ] = await Promise.all([
      prisma.service_requests.count({
        where: { 
          village_id: id,
          status: 'PENDING'
        }
      }),
      prisma.reports.count({
        where: { 
          village_id: id,
          status: { in: ['RECEIVED', 'IN_PROGRESS'] }
        }
      }),
      prisma.conversations.count({
        where: { 
          village_id: id,
          status: { in: ['AI_ACTIVE', 'TAKEOVER'] }
        }
      })
    ]);

    return NextResponse.json({
      success: true,
      data: {
        ...village,
        stats: {
          pendingRequests,
          pendingReports,
          activeConversations
        }
      }
    });

  } catch (error) {
    console.error('Get village detail error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}

// PUT - Update desa
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(request);
  if (isNextResponse(auth)) return auth;

  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.villages.findUnique({
      where: { id }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Desa tidak ditemukan' },
        { status: 404 }
      );
    }

    const village = await prisma.villages.update({
      where: { id },
      data: body
    });

    // Log activity
    await prisma.activity_logs.create({
      data: {
        user_id: auth.userId,
        action: 'UPDATE_VILLAGE',
        resource: `villages:${id}`,
        details: body
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Desa berhasil diperbarui',
      data: village
    });

  } catch (error) {
    console.error('Update village status error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal memperbarui status' },
      { status: 500 }
    );
  }
}

// DELETE - Delete village (hard delete - use with caution)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(request);
  if (isNextResponse(auth)) return auth;

  try {
    const { id } = await params;

    const existing = await prisma.villages.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            service_requests: true,
            reports: true
          }
        }
      }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Desa tidak ditemukan' },
        { status: 404 }
      );
    }

    // Prevent deletion if there are requests or reports
    if (existing._count.service_requests > 0 || existing._count.reports > 0) {
      return NextResponse.json(
        { success: false, error: 'Tidak dapat menghapus desa yang memiliki data permohonan atau laporan. Nonaktifkan saja.' },
        { status: 400 }
      );
    }

    // Delete village (cascade will handle related data)
    await prisma.villages.delete({
      where: { id }
    });

    // Log activity
    await prisma.activity_logs.create({
      data: {
        user_id: auth.userId,
        action: 'DELETE_VILLAGE',
        resource: `villages:${id}`,
        details: { village_name: existing.name }
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Desa berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete village error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menghapus desa' },
      { status: 500 }
    );
  }
}
