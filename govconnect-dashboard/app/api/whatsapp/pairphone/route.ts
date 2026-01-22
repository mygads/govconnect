import { NextResponse } from 'next/server'

const gone = () => NextResponse.json(
  { success: false, error: 'Endpoint ini sudah dihapus.' },
  { status: 410 }
)

export function POST() {
  return gone()
}
