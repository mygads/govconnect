import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse } from '@/lib/auth-middleware';

// GET - Dapatkan profil desa
export async function GET(request: NextRequest) {
  const auth = await requireVillageAdmin(request);
  if (isNextResponse(auth)) return auth;

  try {
    const village = await prisma.villages.findUnique({
      where: { user_id: auth.userId },
      include: {
        operating_hours: {
          orderBy: { day_of_week: 'asc' }
        },
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            phone: true,
            avatar_url: true
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

    return NextResponse.json({
      success: true,
      data: village
    });

  } catch (error) {
    console.error('Get village error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data desa' },
      { status: 500 }
    );
  }
}

// PUT - Update profil desa
export async function PUT(request: NextRequest) {
  const auth = await requireVillageAdmin(request);
  if (isNextResponse(auth)) return auth;

  try {
    const body = await request.json();
    const {
      name,
      address,
      phone,
      email,
      gmaps_url,
      website,
      kode_pos,
      kecamatan,
      kabupaten,
      provinsi,
      kepala_desa,
      nip_kepala_desa,
      logo_url,
      ai_greeting,
      operating_hours
    } = body;

    // Validasi
    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Nama desa wajib diisi' },
        { status: 400 }
      );
    }

    // Update village
    const village = await prisma.villages.update({
      where: { user_id: auth.userId },
      data: {
        name,
        address,
        phone,
        email,
        gmaps_url,
        website,
        kode_pos,
        kecamatan,
        kabupaten,
        provinsi,
        kepala_desa,
        nip_kepala_desa,
        logo_url,
        ai_greeting
      }
    });

    // Update operating hours jika ada
    if (operating_hours && Array.isArray(operating_hours)) {
      for (const hours of operating_hours) {
        await prisma.village_operating_hours.upsert({
          where: {
            village_id_day_of_week: {
              village_id: village.id,
              day_of_week: hours.day_of_week
            }
          },
          update: {
            is_open: hours.is_open,
            open_time: hours.open_time,
            close_time: hours.close_time
          },
          create: {
            village_id: village.id,
            day_of_week: hours.day_of_week,
            is_open: hours.is_open,
            open_time: hours.open_time,
            close_time: hours.close_time
          }
        });
      }
    }

    // Ambil data terbaru dengan relasi
    const updatedVillage = await prisma.villages.findUnique({
      where: { id: village.id },
      include: {
        operating_hours: {
          orderBy: { day_of_week: 'asc' }
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Profil desa berhasil diperbarui',
      data: updatedVillage
    });

  } catch (error) {
    console.error('Update village error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal memperbarui profil desa' },
      { status: 500 }
    );
  }
}
