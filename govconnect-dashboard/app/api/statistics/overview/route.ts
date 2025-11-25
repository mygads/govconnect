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
      const response = await fetch(`${CASE_SERVICE_URL}/statistics/overview`, {
        method: 'GET',
        headers: {
          'x-internal-api-key': INTERNAL_API_KEY,
        },
      })

      if (response.ok) {
        const data = await response.json()
        // Transform data to match dashboard expectations
        return NextResponse.json({
          complaints: {
            total: data.totalLaporan || 0,
            baru: data.laporanByStatus?.baru || 0,
            proses: data.laporanByStatus?.proses || 0,
            selesai: data.laporanByStatus?.selesai || 0,
            ditolak: data.laporanByStatus?.ditolak || 0,
          },
          tickets: {
            total: data.totalTiket || 0,
            pending: data.tiketByStatus?.pending || 0,
            proses: data.tiketByStatus?.proses || 0,
            selesai: data.tiketByStatus?.selesai || 0,
            ditolak: data.tiketByStatus?.ditolak || 0,
          },
        })
      }
    } catch (error) {
      console.log('Case service not available, using mock data')
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
