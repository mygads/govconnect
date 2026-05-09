import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { caseService } from '@/lib/api-client'
import prisma from '@/lib/prisma'
import { resolveVillageTimezone } from '@/lib/utils'

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

    const complaintsRes = await caseService.getLaporan({ village_id: villageId, limit: '50' })
    const complaints = await complaintsRes.json().catch(() => null)
    if (!complaintsRes.ok) {
      partial_errors.push({
        source: 'complaints',
        message: complaints?.error || 'Failed to fetch village complaints from case service',
        status: complaintsRes.status,
      })
    }

    const serviceRequestsRes = await caseService.getServiceRequests({ village_id: villageId, limit: '50' })
    const serviceRequests = await serviceRequestsRes.json().catch(() => null)
    if (!serviceRequestsRes.ok) {
      partial_errors.push({
        source: 'serviceRequests',
        message: serviceRequests?.error || 'Failed to fetch village service requests from case service',
        status: serviceRequestsRes.status,
      })
    }

    const statisticsRes = await caseService.getOverview({ village_id: villageId })
    const statistics = statisticsRes.ok ? await statisticsRes.json().catch(() => null) : null
    if (!statisticsRes.ok) {
      partial_errors.push({
        source: 'statistics',
        message: 'Failed to fetch village statistics from case service',
        status: statisticsRes.status,
      })
    }

    const [
      knowledgeItems,
      documents,
      importantContactCategories,
      complaintCategories,
      serviceCatalog,
      serviceRequestStatusRows,
      complaintStatusRows,
    ] = await Promise.all([
      prisma.knowledge_base.findMany({
        where: { village_id: villageId },
        orderBy: { updated_at: 'desc' },
        take: 50,
        select: {
          id: true,
          title: true,
          category: true,
          priority: true,
          updated_at: true,
          keywords: true,
          content: true,
          last_embedded_at: true,
          last_edited_at: true,
        },
      }),
      prisma.knowledge_documents.findMany({
        where: { village_id: villageId },
        orderBy: { created_at: 'desc' },
        take: 50,
        select: {
          id: true,
          filename: true,
          original_name: true,
          status: true,
          total_chunks: true,
          created_at: true,
          updated_at: true,
          title: true,
          category: true,
          description: true,
          total_tokens: true,
          error_message: true,
        },
      }),
      prisma.important_contact_categories.findMany({
        where: { village_id: villageId },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          contacts: {
            orderBy: { name: 'asc' },
            select: { id: true, name: true, phone: true, description: true },
          },
        },
      }),
      prisma.$queryRaw<Array<{
        id: string
        name: string
        description: string | null
        is_active: boolean
        types_count: bigint
        urgent_count: bigint
      }>>(Prisma.sql`
        SELECT
          c.id,
          c.name,
          c.description,
          c.is_active,
          COUNT(t.id)::bigint AS types_count,
          COUNT(*) FILTER (WHERE t.is_urgent = true)::bigint AS urgent_count
        FROM cases.complaint_categories c
        LEFT JOIN cases.complaint_types t ON t.category_id = c.id
        WHERE c.village_id = ${villageId}
        GROUP BY c.id, c.name, c.description, c.is_active
        ORDER BY c.name ASC
      `),
      prisma.$queryRaw<Array<{
        id: string
        name: string
        description: string
        slug: string
        mode: string
        is_active: boolean
        estimated_cost: string | null
        estimated_processing_time: string | null
        requirements_count: bigint
        category_name: string
      }>>(Prisma.sql`
        SELECT
          s.id,
          s.name,
          s.description,
          s.slug,
          s.mode,
          s.is_active,
          s.estimated_cost,
          s.estimated_processing_time,
          COUNT(r.id)::bigint AS requirements_count,
          c.name AS category_name
        FROM cases.services_dynamic s
        JOIN cases.service_categories c ON c.id = s.category_id
        LEFT JOIN cases.service_requirements r ON r.service_id = s.id
        WHERE s.village_id = ${villageId}
        GROUP BY s.id, c.name
        ORDER BY c.name ASC, s.name ASC
      `),
      prisma.$queryRaw<Array<{ status: string; total: bigint }>>(Prisma.sql`
        SELECT status, COUNT(*)::bigint AS total
        FROM cases.service_requests
        WHERE village_id = ${villageId}
        GROUP BY status
      `),
      prisma.$queryRaw<Array<{ status: string; total: bigint }>>(Prisma.sql`
        SELECT status, COUNT(*)::bigint AS total
        FROM cases.complaints
        WHERE village_id = ${villageId}
        GROUP BY status
      `),
    ])

    return NextResponse.json({
      village: {
        id: village.id,
        name: village.name,
        slug: village.slug,
        timezone: resolveVillageTimezone(village.timezone),
        timezone_raw: village.timezone,
        is_active: village.is_active,
        created_at: village.created_at,
        profile: village.profiles?.[0] || null,
        admins: village.admins,
      },
      complaints: complaintsRes.ok ? (complaints?.data || []) : [],
      complaintCategories: complaintCategories.map((item) => ({
        ...item,
        types_count: Number(item.types_count || 0),
        urgent_count: Number(item.urgent_count || 0),
      })),
      complaintStatusBreakdown: complaintStatusRows.map((item) => ({
        status: item.status,
        total: Number(item.total || 0),
      })),
      serviceRequests: serviceRequestsRes.ok ? (serviceRequests?.data || []) : [],
      serviceCatalog: serviceCatalog.map((item) => ({
        ...item,
        requirements_count: Number(item.requirements_count || 0),
      })),
      serviceRequestStatusBreakdown: serviceRequestStatusRows.map((item) => ({
        status: item.status,
        total: Number(item.total || 0),
      })),
      importantContactCategories,
      knowledgeItems: knowledgeItems.map((item) => ({
        ...item,
        is_embedded: Boolean(item.last_embedded_at),
        needs_reembed: Boolean(item.last_edited_at && (!item.last_embedded_at || item.last_edited_at > item.last_embedded_at)),
      })),
      documents: documents.map((doc) => ({
        ...doc,
        chunk_count: doc.total_chunks ?? 0,
      })),
      statistics,
      partial_errors,
    })
  } catch (error) {
    console.error('Error fetching village detail:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
