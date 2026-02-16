import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// Internal API for AI service to check if chatbot is enabled
// No auth required - uses internal API key

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getInternalApiKey(): string | null {
  return process.env['INTERNAL_API_KEY'] || null
}

export async function GET(request: NextRequest) {
  try {
    // Verify internal API key
    const expectedApiKey = getInternalApiKey()
    if (!expectedApiKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }
    const apiKey = request.headers.get('x-internal-api-key')
    if (!apiKey || apiKey !== expectedApiKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get specific setting by key
    const searchParams = request.nextUrl.searchParams
    const key = searchParams.get('key')

    if (key) {
      const setting = await prisma.system_settings.findUnique({
        where: { key },
      })

      return NextResponse.json({
        key,
        value: setting?.value ?? getDefaultValue(key),
      })
    }

    // Get all settings
    const settings = await prisma.system_settings.findMany()
    
    // Convert to object format with defaults
    const settingsObj: Record<string, string> = {
      ai_chatbot_enabled: 'true',
      ai_model_primary: 'gemini-2.5-flash',
      ai_model_fallback: 'gemini-2.0-flash',
    }
    
    settings.forEach((s: { key: string; value: string }) => {
      settingsObj[s.key] = s.value
    })

    return NextResponse.json({
      data: settingsObj,
    })
  } catch (error) {
    console.error('Error fetching internal settings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    )
  }
}

function getDefaultValue(key: string): string {
  const defaults: Record<string, string> = {
    ai_chatbot_enabled: 'true',
    ai_model_primary: 'gemini-2.5-flash',
    ai_model_fallback: 'gemini-2.0-flash',
    welcome_message: 'Selamat datang di Tanggapin AI!',
  }
  return defaults[key] ?? ''
}
