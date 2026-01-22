import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { caseService } from '@/lib/api-client'

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
      const response = await caseService.getOverview()

      if (response.ok) {
        const data = await response.json()
        console.log('Case service statistics response:', data)
        // Transform data to match dashboard expectations
        // Case service returns: { totalLaporan, totalLayanan, laporan: {baru, proses, selesai, ditolak, hariIni}, layanan: {baru, proses, selesai, ditolak, hariIni} }
        return NextResponse.json({
          complaints: {
            total: data.totalLaporan || 0,
            baru: data.laporan?.baru || 0,
            proses: data.laporan?.proses || 0,
            selesai: data.laporan?.selesai || 0,
            ditolak: data.laporan?.ditolak || 0,
          },
          services: {
            total: data.totalLayanan || 0,
            baru: data.layanan?.baru || 0,
            proses: data.layanan?.proses || 0,
            selesai: data.layanan?.selesai || 0,
            ditolak: data.layanan?.ditolak || 0,
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
      services: {
        total: 0,
        baru: 0,
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
