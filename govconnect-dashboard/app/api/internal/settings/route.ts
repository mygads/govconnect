import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedInternalRequest } from '@/lib/internal-api-auth'
import prisma from '@/lib/prisma'

// Internal API for AI service to check if chatbot is enabled
// No auth required - uses internal API key

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedInternalRequest(request)) {
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
      ai_model_primary: 'openai/gpt-4o-mini',
      ai_model_fallback: 'openai/gpt-4o',
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
    ai_model_primary: 'openai/gpt-4o-mini',
    ai_model_fallback: 'openai/gpt-4o',
    welcome_message: 'Selamat datang di GovConnect!',
  }
  return defaults[key] ?? ''
}
