import { NextResponse } from 'next/server'

export async function GET() {
  const key = process.env['INTERNAL_API_KEY']
  return NextResponse.json({ 
    keyExists: !!key, 
    keyLength: key?.length,
    keyPreview: key ? key.substring(0, 10) + '...' : null
  })
}
