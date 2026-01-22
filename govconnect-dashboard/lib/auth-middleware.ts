import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyUserToken, UserJWTPayload } from '@/lib/auth';
import { UserRole } from '@prisma/client';

export interface AuthenticatedRequest extends NextRequest {
  user: UserJWTPayload;
}

export async function authenticateUser(request: NextRequest): Promise<{
  success: boolean;
  user?: UserJWTPayload;
  error?: string;
}> {
  try {
    const authHeader = request.headers.get('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { success: false, error: 'Token tidak ditemukan' };
    }

    const token = authHeader.substring(7);
    const payload = await verifyUserToken(token);

    if (!payload) {
      return { success: false, error: 'Token tidak valid atau sudah kadaluarsa' };
    }

    // Verifikasi session masih aktif
    const session = await prisma.user_sessions.findFirst({
      where: {
        token,
        expires_at: { gt: new Date() }
      }
    });

    if (!session) {
      return { success: false, error: 'Session tidak valid' };
    }

    // Verifikasi user masih aktif
    const user = await prisma.users.findUnique({
      where: { id: payload.userId }
    });

    if (!user || !user.is_active) {
      return { success: false, error: 'User tidak aktif' };
    }

    return { success: true, user: payload };
  } catch (error) {
    console.error('Auth error:', error);
    return { success: false, error: 'Authentication error' };
  }
}

export async function requireAuth(request: NextRequest): Promise<NextResponse | UserJWTPayload> {
  const auth = await authenticateUser(request);
  
  if (!auth.success || !auth.user) {
    return NextResponse.json(
      { success: false, error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  }

  return auth.user;
}

export async function requireVillageAdmin(request: NextRequest): Promise<NextResponse | UserJWTPayload> {
  const auth = await authenticateUser(request);
  
  if (!auth.success || !auth.user) {
    return NextResponse.json(
      { success: false, error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  }

  if (auth.user.role !== UserRole.VILLAGE_ADMIN && auth.user.role !== UserRole.SUPER_ADMIN) {
    return NextResponse.json(
      { success: false, error: 'Akses ditolak' },
      { status: 403 }
    );
  }

  return auth.user;
}

export async function requireSuperAdmin(request: NextRequest): Promise<NextResponse | UserJWTPayload> {
  const auth = await authenticateUser(request);
  
  if (!auth.success || !auth.user) {
    return NextResponse.json(
      { success: false, error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  }

  if (auth.user.role !== UserRole.SUPER_ADMIN) {
    return NextResponse.json(
      { success: false, error: 'Akses ditolak. Hanya Super Admin yang bisa mengakses.' },
      { status: 403 }
    );
  }

  return auth.user;
}

export function isNextResponse(result: NextResponse | UserJWTPayload): result is NextResponse {
  return result instanceof NextResponse;
}

// Helper untuk mendapatkan village ID dari user
export async function getVillageIdFromUser(userId: string): Promise<string | null> {
  const village = await prisma.villages.findUnique({
    where: { user_id: userId },
    select: { id: true }
  });
  return village?.id || null;
}
