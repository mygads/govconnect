import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { generateTicketNumber } from '@/lib/auth';

// POST - Submit permohonan layanan (public)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ villageSlug: string; serviceSlug: string }> }
) {
  try {
    const { villageSlug, serviceSlug } = await params;

    const village = await prisma.villages.findFirst({
      where: { 
        short_name: villageSlug
      }
    });

    if (!village) {
      return NextResponse.json(
        { success: false, error: 'Desa tidak ditemukan' },
        { status: 404 }
      );
    }

    const service = await prisma.services.findFirst({
      where: { 
        slug: serviceSlug,
        village_id: village.id,
        is_active: true
      },
      include: {
        requirements: true
      }
    });

    if (!service) {
      return NextResponse.json(
        { success: false, error: 'Layanan tidak ditemukan' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { 
      applicant_name,
      applicant_nik,
      applicant_phone,
      applicant_email,
      applicant_address,
      delivery_method,
      notes,
      requirements: filledRequirements = []
    } = body;

    // Validate required fields
    if (!applicant_name || !applicant_nik || !applicant_phone) {
      return NextResponse.json(
        { success: false, error: 'Nama, NIK, dan nomor telepon wajib diisi' },
        { status: 400 }
      );
    }

    // Validate required requirements
    const requiredReqs = service.requirements.filter((r: any) => r.is_required);
    for (const req of requiredReqs) {
      const filled = filledRequirements.find((f: any) => f.requirement_id === req.id);
      if (!filled || (!filled.text_value && !filled.file_path)) {
        return NextResponse.json(
          { success: false, error: `Persyaratan "${req.name}" wajib diisi` },
          { status: 400 }
        );
      }
    }

    // Generate ticket number
    const ticketNumber = generateTicketNumber('LYN');

    // Create service request with requirements
    const serviceRequest = await prisma.$transaction(async (tx) => {
      const newRequest = await tx.service_requests.create({
        data: {
          village_id: village.id,
          service_id: service.id,
          ticket_number: ticketNumber,
          applicant_name,
          applicant_nik,
          applicant_phone,
          applicant_email,
          applicant_address,
          delivery_method: delivery_method || service.delivery_method || 'PICKUP',
          status: 'PENDING'
        }
      });

      // Create filled requirements
      if (filledRequirements.length > 0) {
        await tx.service_request_requirements.createMany({
          data: filledRequirements.map((req: any) => ({
            request_id: newRequest.id,
            requirement_id: req.requirement_id,
            text_value: req.text_value || req.value,
            file_path: req.file_path || req.file_url,
            file_name: req.file_name
          }))
        });
      }

      // Create initial status history
      await tx.service_request_status_history.create({
        data: {
          request_id: newRequest.id,
          status: 'PENDING',
          created_by: 'Sistem',
          notes: 'Permohonan baru diterima'
        }
      });

      return tx.service_requests.findUnique({
        where: { id: newRequest.id },
        include: {
          service: {
            select: {
              name: true,
              processing_time: true
            }
          },
          requirements: {
            include: {
              requirement: true
            }
          }
        }
      });
    });

    // TODO: Send notification to village admin
    // TODO: Send confirmation to applicant via WhatsApp/Email

    return NextResponse.json({
      success: true,
      message: 'Permohonan berhasil diajukan',
      data: {
        ticket_number: ticketNumber,
        service_name: serviceRequest?.service?.name,
        processing_time: serviceRequest?.service?.processing_time,
        status: 'PENDING',
        tracking_url: `${process.env.NEXT_PUBLIC_BASE_URL || ''}/track/${ticketNumber}`
      }
    });

  } catch (error) {
    console.error('Submit service request error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengajukan permohonan' },
      { status: 500 }
    );
  }
}
