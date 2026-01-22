import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword, generateUserToken, generateSlug } from '@/lib/auth';
import { UserRole } from '@prisma/client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      email,
      password,
      name,
      phone,
      village_name,
      village_short_name,
      kecamatan,
      kabupaten,
      provinsi
    } = body;

    // Validasi input
    if (!email || !password || !name || !village_name || !village_short_name) {
      return NextResponse.json(
        { success: false, error: 'Email, password, nama, nama desa, dan nama singkat desa wajib diisi' },
        { status: 400 }
      );
    }

    // Validasi format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, error: 'Format email tidak valid' },
        { status: 400 }
      );
    }

    // Validasi password minimal 6 karakter
    if (password.length < 6) {
      return NextResponse.json(
        { success: false, error: 'Password minimal 6 karakter' },
        { status: 400 }
      );
    }

    // Generate slug dari short_name
    const slug = generateSlug(village_short_name);

    // Cek apakah email sudah terdaftar
    const existingUser = await prisma.users.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'Email sudah terdaftar' },
        { status: 400 }
      );
    }

    // Cek apakah short_name sudah digunakan
    const existingVillage = await prisma.villages.findUnique({
      where: { short_name: slug }
    });

    if (existingVillage) {
      return NextResponse.json(
        { success: false, error: 'Nama singkat desa sudah digunakan, pilih nama lain' },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Buat user dan village dalam satu transaksi
    const result = await prisma.$transaction(async (tx) => {
      // Buat user
      const user = await tx.users.create({
        data: {
          email: email.toLowerCase(),
          password_hash: hashedPassword,
          name,
          phone,
          role: UserRole.VILLAGE_ADMIN,
          is_active: true
        }
      });

      // Buat village
      const village = await tx.villages.create({
        data: {
          user_id: user.id,
          name: village_name,
          short_name: slug,
          kecamatan,
          kabupaten,
          provinsi,
          whatsapp_enabled: false,
          webchat_enabled: false,
          ai_enabled: true,
          ai_greeting: `Selamat datang di layanan informasi ${village_name}! Ada yang bisa kami bantu?`
        }
      });

      // Buat default operating hours (Senin-Jumat 08:00-16:00)
      const operatingHours = [];
      for (let i = 0; i < 7; i++) {
        operatingHours.push({
          village_id: village.id,
          day_of_week: i,
          is_open: i >= 1 && i <= 5, // Senin-Jumat
          open_time: i >= 1 && i <= 5 ? '08:00' : null,
          close_time: i >= 1 && i <= 5 ? '16:00' : null
        });
      }
      
      await tx.village_operating_hours.createMany({
        data: operatingHours
      });

      // Buat default knowledge categories
      const defaultCategories = [
        { name: 'Profil Desa', type: 'PROFIL_DESA' as const, icon: 'building', order: 1 },
        { name: 'FAQ', type: 'FAQ' as const, icon: 'help-circle', order: 2 },
        { name: 'Struktur Desa', type: 'STRUKTUR_DESA' as const, icon: 'users', order: 3 },
        { name: 'Informasi Layanan', type: 'LAYANAN' as const, icon: 'file-text', order: 4 }
      ];

      await tx.knowledge_categories.createMany({
        data: defaultCategories.map(cat => ({
          village_id: village.id,
          ...cat,
          is_active: true
        }))
      });

      // Buat default report categories
      const defaultReportCategories = [
        { name: 'Bencana', icon: 'alert-triangle', order: 1 },
        { name: 'Keamanan', icon: 'shield', order: 2 },
        { name: 'Infrastruktur', icon: 'tool', order: 3 },
        { name: 'Lingkungan', icon: 'leaf', order: 4 },
        { name: 'Lainnya', icon: 'more-horizontal', order: 5 }
      ];

      await tx.report_categories.createMany({
        data: defaultReportCategories.map(cat => ({
          village_id: village.id,
          ...cat,
          is_active: true
        }))
      });

      // Buat default service categories
      const defaultServiceCategories = [
        { name: 'Layanan Administrasi Desa', icon: 'file', order: 1 },
        { name: 'Layanan Kependudukan', icon: 'user', order: 2 },
        { name: 'Layanan Perizinan', icon: 'check-circle', order: 3 }
      ];

      await tx.service_categories.createMany({
        data: defaultServiceCategories.map(cat => ({
          village_id: village.id,
          ...cat,
          is_active: true
        }))
      });

      return { user, village };
    });

    // Generate token
    const token = await generateUserToken({
      userId: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.role,
      villageId: result.village.id,
      villageShortName: result.village.short_name
    });

    // Simpan session
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.user_sessions.create({
      data: {
        user_id: result.user.id,
        token,
        expires_at: expiresAt,
        ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip')
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Registrasi berhasil',
      data: {
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role
        },
        village: {
          id: result.village.id,
          name: result.village.name,
          short_name: result.village.short_name
        },
        token
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { success: false, error: 'Terjadi kesalahan saat registrasi' },
      { status: 500 }
    );
  }
}
