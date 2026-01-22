import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { comparePassword, generateUserToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    // Validasi input
    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email dan password wajib diisi' },
        { status: 400 }
      );
    }

    // Cari user berdasarkan email
    const user = await prisma.users.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        village: true
      }
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Email atau password salah' },
        { status: 401 }
      );
    }

    // Cek apakah user aktif
    if (!user.is_active) {
      return NextResponse.json(
        { success: false, error: 'Akun tidak aktif. Hubungi administrator.' },
        { status: 401 }
      );
    }

    // Verifikasi password
    const isValid = await comparePassword(password, user.password_hash);
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: 'Email atau password salah' },
        { status: 401 }
      );
    }

    // Generate token
    const token = await generateUserToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      villageId: user.village?.id,
      villageShortName: user.village?.short_name
    });

    // Simpan session
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.user_sessions.create({
      data: {
        user_id: user.id,
        token,
        expires_at: expiresAt,
        ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
        user_agent: request.headers.get('user-agent')
      }
    });

    // Log activity
    await prisma.activity_logs.create({
      data: {
        user_id: user.id,
        action: 'LOGIN',
        resource: 'auth',
        details: {
          ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
          userAgent: request.headers.get('user-agent')
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Login berhasil',
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          phone: user.phone,
          avatar_url: user.avatar_url
        },
        village: user.village ? {
          id: user.village.id,
          name: user.village.name,
          short_name: user.village.short_name,
          logo_url: user.village.logo_url
        } : null,
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { success: false, error: 'Terjadi kesalahan saat login' },
      { status: 500 }
    );
  }
}
