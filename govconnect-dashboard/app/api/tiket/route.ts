import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json(
    { error: 'FITUR_DINONAKTIFKAN', message: 'Fitur ini telah dinonaktifkan.' },
    { status: 410 }
  )
}
