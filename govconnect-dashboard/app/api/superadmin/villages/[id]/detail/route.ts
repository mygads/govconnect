import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { caseService, ai, livechat } from '@/lib/api-client'
import prisma from '@/lib/prisma'

// GET - Get village detail data (complaints, services, knowledge) for superadmin
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAdminSession(request)
    if (!session || session.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: villageId } = await params

    // Get village info
    const village = await prisma.villages.findUnique({
      where: { id: villageId },
      include: {
        profiles: true,
        admins: {
          select: { id: true, name: true, username: true, role: true, is_active: true },
        },
      },
    })

    if (!village) {
      return NextResponse.json({ error: 'Village not found' }, { status: 404 })
    }

    const partial_errors: Array<{ source: string; message: string; status?: number }> = []

    // Get complaints from case service (fail-open)
    const complaintsRes = await caseService.getLaporan({ village_id: villageId, limit: '50' })
    const complaints = await complaintsRes.json().catch(() => null)
    if (!complaintsRes.ok) {
      partial_errors.push({
        source: 'complaints',
        message: complaints?.error || 'Failed to fetch village complaints from case service',
        status: complaintsRes.status,
      })
    }

    // Get service requests from case service (fail-open)
    const serviceRequestsRes = await caseService.getServiceRequests({ village_id: villageId, limit: '50' })
    const serviceRequests = await serviceRequestsRes.json().catch(() => null)
    if (!serviceRequestsRes.ok) {
      partial_errors.push({
        source: 'serviceRequests',
        message: serviceRequests?.error || 'Failed to fetch village service requests from case service',
        status: serviceRequestsRes.status,
      })
    }

    // Get knowledge base from local DB
    const knowledgeItems = await prisma.knowledge_base.findMany({
      where: { village_id: villageId },
      orderBy: { updated_at: 'desc' },
      take: 50,
    })

    // Get knowledge documents from local DB
    const documents = await prisma.knowledge_documents.findMany({
      where: { village_id: villageId },
      orderBy: { created_at: 'desc' },
      take: 20,
    })

    // Get statistics overview from case service
    const statisticsRes = await caseService.getOverview({ village_id: villageId })
    const statistics = statisticsRes.ok ? await statisticsRes.json().catch(() => null) : null

    return NextResponse.json({
      village: {
        id: village.id,
        name: village.name,
        slug: village.slug,
        is_active: village.is_active,
        created_at: village.created_at,
        profile: village.profiles?.[0] || null,
        admins: village.admins,
      },
      complaints: complaintsRes.ok ? (complaints?.data || []) : [],
      serviceRequests: serviceRequestsRes.ok ? (serviceRequests?.data || []) : [],
      knowledgeItems,
      documents,
      statistics,
      partial_errors,
    })
  } catch (error) {
    console.error('Error fetching village detail:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
