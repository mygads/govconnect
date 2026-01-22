import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

// GET - List responses untuk laporan
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

    // Verify report belongs to village
    const report = await prisma.reports.findFirst({
      where: { id: reportId, village_id: villageId }
    });

    if (!report) {
      return NextResponse.json(
        { success: false, error: 'Laporan tidak ditemukan' },
        { status: 404 }
      );
    }

    const responses = await prisma.report_responses.findMany({
      where: { report_id: reportId },
      orderBy: { created_at: 'desc' }
    });

    return NextResponse.json({
      success: true,
      data: responses
    });

  } catch (error) {
    console.error('Get report responses error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}

// POST - Tambah response/tanggapan
export async function POST(
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
    const { message, new_status, is_public = true, attachments } = body;

    // Verify report belongs to village
    const report = await prisma.reports.findFirst({
      where: { id: reportId, village_id: villageId }
    });

    if (!report) {
      return NextResponse.json(
        { success: false, error: 'Laporan tidak ditemukan' },
        { status: 404 }
      );
    }

    if (!message) {
      return NextResponse.json(
        { success: false, error: 'Pesan tanggapan wajib diisi' },
        { status: 400 }
      );
    }

    // Create response and optionally update report status
    const result = await prisma.$transaction(async (tx) => {
      const response = await tx.report_responses.create({
        data: {
          report_id: reportId,
          created_by: auth.name || 'Admin Desa',
          message,
          image_urls: attachments || []
        }
      });

      // Update report status if new_status provided
      if (new_status) {
        await tx.reports.update({
          where: { id: reportId },
          data: { 
            status: new_status,
            ...(new_status === 'RESOLVED' && { resolved_at: new Date() })
          }
        });
      }

      return response;
    });

    // TODO: Send notification to reporter via channel (WhatsApp/etc)

    return NextResponse.json({
      success: true,
      message: 'Tanggapan berhasil ditambahkan',
      data: result
    });

  } catch (error) {
    console.error('Create report response error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menambahkan tanggapan' },
      { status: 500 }
    );
  }
}
