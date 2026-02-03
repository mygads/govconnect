import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Increase body size limit for file uploads (10MB)
export const maxDuration = 60

const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://localhost:3001'
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ''

const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

export async function POST(request: NextRequest) {
  try {
    // Check content type to ensure it's multipart/form-data
    const contentType = request.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Content-Type harus multipart/form-data' },
        { status: 400 }
      )
    }

    let formData: FormData
    try {
      formData = await request.formData()
    } catch (parseError: any) {
      console.error('FormData parse error:', parseError)
      return NextResponse.json(
        { error: 'Gagal membaca form data', details: parseError.message },
        { status: 400 }
      )
    }

    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'File wajib diunggah' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: 'Tipe file tidak didukung. Gunakan PDF/JPG/PNG/DOC/DOCX.' },
        { status: 400 }
      )
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Ukuran file maksimal 5MB' }, { status: 400 })
    }

    const forward = new FormData()
    forward.append('file', file, file.name)

    let response: Response
    try {
      response = await fetch(`${CHANNEL_SERVICE_URL}/internal/media/upload?scope=service-requests`, {
        method: 'POST',
        headers: {
          'x-internal-api-key': INTERNAL_API_KEY,
        },
        body: forward,
      })
    } catch (fetchError: any) {
      console.error('Fetch to channel service error:', fetchError)
      return NextResponse.json(
        { error: 'Gagal terhubung ke server upload', details: fetchError.message },
        { status: 502 }
      )
    }

    // Get response text first to handle non-JSON responses
    const responseText = await response.text()
    let result: any = null
    
    try {
      result = JSON.parse(responseText)
    } catch {
      console.error('Channel service returned non-JSON:', responseText.substring(0, 200))
      if (!response.ok) {
        return NextResponse.json(
          { error: 'Server upload error', details: responseText.substring(0, 100) },
          { status: response.status }
        )
      }
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: result?.error || 'Gagal mengunggah file' },
        { status: response.status }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        url: result?.data?.url,
        internal_url: result?.data?.internal_url,
        mime_type: result?.data?.mime_type,
        size: result?.data?.size,
      },
    })
  } catch (error: any) {
    console.error('Upload API error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
