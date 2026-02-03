import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'

async function getSession(request: NextRequest) {
  const token = request.cookies.get('token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const session = await prisma.admin_sessions.findUnique({
    where: { token },
    include: { admin: true }
  })
  if (!session || session.expires_at < new Date()) return null
  return session
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  
  const { id } = await context.params
  
  const category = await prisma.important_contact_categories.findUnique({
    where: { id },
    include: { contacts: true }
  })
  
  if (!category) {
    return NextResponse.json({ error: 'Category not found' }, { status: 404 })
  }
  
  if (category.village_id !== session.admin.village_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  
  // Check if this category is linked to any complaint types
  // The complaint_types table uses the category NAME to link, not ID
  let linkedComplaintTypes: any[] = []
  try {
    const response = await apiFetch(buildUrl(ServicePath.CASE, '/complaints/types'), {
      method: 'GET',
      headers: getHeaders(),
    })
    
    if (response.ok) {
      const data = await response.json()
      const allTypes = data.data || []
      linkedComplaintTypes = allTypes.filter((type: any) => 
        type.send_important_contacts && type.important_contact_category === category.name
      )
    }
  } catch (error) {
    console.error('Error fetching complaint types:', error)
  }
  
  return NextResponse.json({ 
    data: category,
    linkedComplaintTypes: linkedComplaintTypes.map((t: any) => ({
      id: t.id,
      name: t.name,
      category_name: t.category?.name || ''
    }))
  })
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  
  const { id } = await context.params
  
  const existingCategory = await prisma.important_contact_categories.findUnique({
    where: { id }
  })
  
  if (!existingCategory) {
    return NextResponse.json({ error: 'Category not found' }, { status: 404 })
  }
  
  if (existingCategory.village_id !== session.admin.village_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  
  const body = await request.json()
  const { name } = body
  
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  
  const oldName = existingCategory.name
  
  const category = await prisma.important_contact_categories.update({
    where: { id },
    data: { name },
    include: { contacts: true }
  })
  
  // If name changed, update all complaint types that reference the old name
  if (oldName !== name) {
    try {
      const response = await apiFetch(buildUrl(ServicePath.CASE, '/complaints/types'), {
        method: 'GET',
        headers: getHeaders(),
      })
      
      if (response.ok) {
        const data = await response.json()
        const allTypes = data.data || []
        const linkedTypes = allTypes.filter((type: any) => 
          type.send_important_contacts && type.important_contact_category === oldName
        )
        
        // Update each linked type with new category name
        for (const type of linkedTypes) {
          await apiFetch(buildUrl(ServicePath.CASE, `/complaints/types/${type.id}`), {
            method: 'PATCH',
            headers: getHeaders(),
            body: JSON.stringify({
              name: type.name,
              description: type.description,
              is_urgent: type.is_urgent,
              require_address: type.require_address,
              send_important_contacts: true,
              important_contact_category: name,
            }),
          })
        }
      }
    } catch (error) {
      console.error('Error updating linked complaint types:', error)
    }
  }
  
  return NextResponse.json({ data: category })
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  
  const { id } = await context.params
  
  const existingCategory = await prisma.important_contact_categories.findUnique({
    where: { id },
    include: { contacts: true }
  })
  
  if (!existingCategory) {
    return NextResponse.json({ error: 'Category not found' }, { status: 404 })
  }
  
  if (existingCategory.village_id !== session.admin.village_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  
  // Check for linked complaint types
  let linkedComplaintTypes: any[] = []
  try {
    const response = await apiFetch(buildUrl(ServicePath.CASE, '/complaints/types'), {
      method: 'GET',
      headers: getHeaders(),
    })
    
    if (response.ok) {
      const data = await response.json()
      const allTypes = data.data || []
      linkedComplaintTypes = allTypes.filter((type: any) => 
        type.send_important_contacts && type.important_contact_category === existingCategory.name
      )
    }
  } catch (error) {
    console.error('Error fetching complaint types:', error)
  }
  
  // If there are linked complaint types, clear their important_contact_category
  if (linkedComplaintTypes.length > 0) {
    for (const type of linkedComplaintTypes) {
      try {
        await apiFetch(buildUrl(ServicePath.CASE, `/complaints/types/${type.id}`), {
          method: 'PATCH',
          headers: getHeaders(),
          body: JSON.stringify({
            name: type.name,
            description: type.description,
            is_urgent: type.is_urgent,
            require_address: type.require_address,
            send_important_contacts: false,
            important_contact_category: null,
          }),
        })
      } catch (error) {
        console.error('Error updating complaint type:', error)
      }
    }
  }
  
  // Delete the category (this will cascade delete all contacts in this category)
  await prisma.important_contact_categories.delete({
    where: { id }
  })
  
  return NextResponse.json({ 
    success: true,
    linkedTypesCleared: linkedComplaintTypes.length
  })
}
