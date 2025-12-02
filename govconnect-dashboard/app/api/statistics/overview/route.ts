import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || 'http://case-service:3003'
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'shared-secret-key-12345'

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

    // Try to forward request to case service
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 25000) // 25 second timeout
      
      const response = await fetch(`${CASE_SERVICE_URL}/statistics/overview`, {
        method: 'GET',
        headers: {
          'x-internal-api-key': INTERNAL_API_KEY,
        },
        signal: controller.signal,
      })
      
      clearTimeout(timeoutId)

      if (response.ok) {
        const data = await response.json()
        console.log('Case service statistics response:', data)
        // Transform data to match dashboard expectations
        // Case service returns: { totalLaporan, totalTiket, laporan: {baru, proses, selesai, hariIni}, tiket: {pending, proses, selesai, hariIni} }
        return NextResponse.json({
          complaints: {
            total: data.totalLaporan || 0,
            baru: data.laporan?.baru || 0,
            proses: data.laporan?.proses || 0,
            selesai: data.laporan?.selesai || 0,
            ditolak: data.laporan?.ditolak || 0,
          },
          tickets: {
            total: data.totalTiket || 0,
            pending: data.tiket?.pending || 0,
            proses: data.tiket?.proses || 0,
            selesai: data.tiket?.selesai || 0,
            ditolak: data.tiket?.ditolak || 0,
          },
        })
      }
    } catch (error) {
      console.log('Case service not available, using mock data:', error)
    }

    // Return mock data if case service not available
    return NextResponse.json({
      complaints: {
        total: 0,
        baru: 0,
        proses: 0,
        selesai: 0,
        ditolak: 0,
      },
      tickets: {
        total: 0,
        pending: 0,
        proses: 0,
        selesai: 0,
        ditolak: 0,
      },
    })
  } catch (error) {
    console.error('Error fetching statistics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500 }
    )
  }
}
