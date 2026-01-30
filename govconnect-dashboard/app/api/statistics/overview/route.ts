import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { caseService } from '@/lib/api-client'

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    const token = request.cookies.get('token')?.value || authHeader?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
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
        // Case service returns: { totalLaporan, totalLayanan, laporan: {open, process, done, canceled, reject, hariIni}, layanan: {open, process, done, canceled, reject, hariIni} }
        return NextResponse.json({
          complaints: {
            total: data.totalLaporan || 0,
            open: data.laporan?.open || 0,
            process: data.laporan?.process || 0,
            done: data.laporan?.done || 0,
            canceled: data.laporan?.canceled || 0,
            reject: data.laporan?.reject || 0,
          },
          services: {
            total: data.totalLayanan || 0,
            open: data.layanan?.open || 0,
            process: data.layanan?.process || 0,
            done: data.layanan?.done || 0,
            canceled: data.layanan?.canceled || 0,
            reject: data.layanan?.reject || 0,
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
        open: 0,
        process: 0,
        done: 0,
        canceled: 0,
        reject: 0,
      },
      services: {
        total: 0,
        open: 0,
        process: 0,
        done: 0,
        canceled: 0,
        reject: 0,
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
