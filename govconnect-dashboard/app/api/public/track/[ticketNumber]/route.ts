import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// GET - Track permohonan by ticket number (public)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketNumber: string }> }
) {
  try {
    const { ticketNumber } = await params;

    const serviceRequest = await prisma.service_requests.findUnique({
      where: { ticket_number: ticketNumber },
      include: {
        village: {
          select: {
            name: true,
            short_name: true,
            phone: true
          }
        },
        service: {
          select: {
            name: true,
            processing_time: true,
            category: {
              select: {
                name: true
              }
            }
          }
        },
        status_history: {
          orderBy: { created_at: 'desc' },
          select: {
            status: true,
            notes: true,
            created_at: true
          }
        }
      }
    });

    if (!serviceRequest) {
      return NextResponse.json(
        { success: false, error: 'Permohonan tidak ditemukan' },
        { status: 404 }
      );
    }

    // Return limited public info
    return NextResponse.json({
      success: true,
      data: {
        ticket_number: serviceRequest.ticket_number,
        village: serviceRequest.village,
        service: serviceRequest.service,
        applicant_name: serviceRequest.applicant_name,
        status: serviceRequest.status,
        delivery_method: serviceRequest.delivery_method,
        reject_reason: serviceRequest.reject_reason,
        created_at: serviceRequest.created_at,
        completed_at: serviceRequest.completed_at,
        status_history: serviceRequest.status_history
      }
    });

  } catch (error) {
    console.error('Track service request error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}
