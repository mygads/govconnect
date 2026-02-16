import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'

// Default settings (tanpa konfigurasi model AI di UI)
const DEFAULT_SETTINGS = {
  ai_chatbot_enabled: 'true',
  welcome_message: 'Selamat datang di Tanggapin AI! Saya siap membantu Anda dengan laporan dan layanan pemerintah.',
}

const DISALLOWED_KEYS = ['ai_model_primary', 'ai_model_fallback', 'ai_model'];

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Get all settings
    const settings = await prisma.system_settings.findMany()
    
    // Convert to object format
    const settingsObj: Record<string, string> = {}
    settings.forEach((s: { key: string; value: string }) => {
      settingsObj[s.key] = s.value
    })

    // Merge with defaults
    const mergedSettings = { ...DEFAULT_SETTINGS, ...settingsObj }

    return NextResponse.json({
      data: mergedSettings,
    })
  } catch (error) {
    console.error('Error fetching settings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Only superadmin can update settings
    if (payload.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { key, value, description } = body

    if (!key || value === undefined) {
      return NextResponse.json(
        { error: 'Key and value are required' },
        { status: 400 }
      )
    }

    if (DISALLOWED_KEYS.includes(key)) {
      return NextResponse.json(
        { error: 'Perubahan model AI hanya melalui ENV' },
        { status: 400 }
      )
    }

    // Upsert setting
    const setting = await prisma.system_settings.upsert({
      where: { key },
      update: {
        value: String(value),
        description,
      },
      create: {
        key,
        value: String(value),
        description,
      },
    })

    return NextResponse.json({
      status: 'success',
      data: setting,
    })
  } catch (error) {
    console.error('Error updating setting:', error)
    return NextResponse.json(
      { error: 'Failed to update setting' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Only superadmin can update settings
    if (payload.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { settings } = body as { settings: Record<string, string> }

    if (!settings || typeof settings !== 'object') {
      return NextResponse.json(
        { error: 'Settings object is required' },
        { status: 400 }
      )
    }

    const invalidKeys = Object.keys(settings).filter((key) => DISALLOWED_KEYS.includes(key))
    if (invalidKeys.length > 0) {
      return NextResponse.json(
        { error: 'Perubahan model AI hanya melalui ENV', invalid_keys: invalidKeys },
        { status: 400 }
      )
    }

    // Batch upsert settings
    const updates = await Promise.all(
      Object.entries(settings).map(([key, value]) =>
        prisma.system_settings.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) },
        })
      )
    )

    return NextResponse.json({
      status: 'success',
      data: updates,
    })
  } catch (error) {
    console.error('Error batch updating settings:', error)
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    )
  }
}
