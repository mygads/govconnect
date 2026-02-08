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

    // Get complaints from case service
    let complaints = { data: [], pagination: null }
    try {
      const res = await caseService.getLaporan({ village_id: villageId, limit: '50' })
      if (res.ok) complaints = await res.json()
    } catch (e) { console.log('Case service unavailable') }

    // Get service requests from case service
    let serviceRequests = { data: [], pagination: null }
    try {
      const res = await caseService.getServiceRequests({ village_id: villageId, limit: '50' })
      if (res.ok) serviceRequests = await res.json()
    } catch (e) { console.log('Case service unavailable') }

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
    let statistics = null
    try {
      const res = await caseService.getOverview({ village_id: villageId })
      if (res.ok) statistics = await res.json()
    } catch (e) { console.log('Case service unavailable for stats') }

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
      complaints: complaints.data || [],
      serviceRequests: serviceRequests.data || [],
      knowledgeItems,
      documents,
      statistics,
    })
  } catch (error) {
    console.error('Error fetching village detail:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
